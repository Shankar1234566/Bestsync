/**
 * Typing engine — pure, deterministic character/keystroke accounting.
 *
 * Design notes:
 * - WPM uses the standard five-character word convention: (correctChars / 5) / minutes.
 * - `correctChars` is live: characters currently correct in the active line plus
 *   characters frozen from completed lines, so backspacing within a line lowers
 *   WPM instead of being gameable.
 * - `totalMistakes` is cumulative and never decreases; accuracy =
 *   (keystrokes - totalMistakes) / keystrokes.
 * - Combo increments on correct keystrokes and resets on a wrong keystroke.
 */
import type { LiveStats } from './types';
import { computeScore } from './scoring';
import type { GameMode } from './constants';

export interface TypingCounters {
  correctChars: number;
  incorrectChars: number;
  totalMistakes: number;
  keystrokes: number;
  backspaces: number;
  combo: number;
  bestCombo: number;
}

export interface TypingState {
  /** Raw characters typed for the active line (may contain wrong chars). */
  typed: string;
  /** Characters frozen from lines already finalised. */
  completedCorrectChars: number;
  linesCompleted: number;
  linesMissed: number;
  counters: TypingCounters;
}

export function createTypingState(): TypingState {
  return {
    typed: '',
    completedCorrectChars: 0,
    linesCompleted: 0,
    linesMissed: 0,
    counters: {
      correctChars: 0,
      incorrectChars: 0,
      totalMistakes: 0,
      keystrokes: 0,
      backspaces: 0,
      combo: 0,
      bestCombo: 0,
    },
  };
}

/** Live correctness of the current partial input against the target line. */
function liveCounts(typed: string, target: string): { correct: number; incorrect: number } {
  let correct = 0;
  for (let i = 0; i < typed.length; i += 1) {
    if (typed[i] === target[i]) correct += 1;
  }
  return { correct, incorrect: typed.length - correct };
}

function refreshLive(state: TypingState, target: string): void {
  const live = liveCounts(state.typed, target);
  state.counters.correctChars = state.completedCorrectChars + live.correct;
  state.counters.incorrectChars = live.incorrect;
}

export type InputResult = 'accepted' | 'ignored' | 'line-complete';

/**
 * Apply one printable keystroke to the active line.
 * Control characters and multi-char input are ignored.
 */
export function typingInput(state: TypingState, target: string, char: string): InputResult {
  if (char.length !== 1 || char === '\n' || char === '\r' || char === '\t') return 'ignored';
  if (state.typed.length >= target.length) return 'ignored';

  const expected = target[state.typed.length];
  state.typed += char;
  state.counters.keystrokes += 1;

  if (char === expected) {
    state.counters.combo += 1;
    if (state.counters.combo > state.counters.bestCombo) {
      state.counters.bestCombo = state.counters.combo;
    }
  } else {
    state.counters.totalMistakes += 1;
    state.counters.combo = 0;
  }

  refreshLive(state, target);
  return state.typed.length >= target.length ? 'line-complete' : 'accepted';
}

/** Remove the last typed character (correction). Mistakes stay counted. */
export function typingBackspace(state: TypingState, target: string): boolean {
  if (state.typed.length === 0) return false;
  state.typed = state.typed.slice(0, -1);
  state.counters.backspaces += 1;
  refreshLive(state, target);
  return true;
}

export type FinalizeReason = 'completed' | 'passed' | 'abandoned';

/**
 * Freeze the active line into the cumulative counters and reset the input.
 * - `completed` — the player finished the line.
 * - `passed`   — playback moved past an unfinished line (beat mode miss).
 * - `abandoned` — the player stopped early (results screen / song end).
 */
export function finalizeLine(
  state: TypingState,
  target: string,
  reason: FinalizeReason,
): void {
  const live = liveCounts(state.typed, target);
  state.completedCorrectChars += live.correct;

  if (reason === 'completed') {
    state.linesCompleted += 1;
  } else if (reason === 'passed') {
    state.linesMissed += 1;
  }

  state.typed = '';
  state.counters.incorrectChars = 0;
  state.counters.correctChars = state.completedCorrectChars;
}

/** True when the active line has been fully typed. */
export function isLineComplete(state: TypingState, target: string): boolean {
  return state.typed.length >= target.length && target.length > 0;
}

export interface StatsContext {
  elapsedMs: number;
  totalLines: number;
  mode: GameMode;
  tempoRate: number;
}

/** Compute the full live statistics snapshot for the HUD and results screen. */
export function computeStats(state: TypingState, ctx: StatsContext): LiveStats {
  const minutes = Math.max(ctx.elapsedMs, 0) / 60_000;
  const { counters } = state;

  const wpm = minutes > 0 ? counters.correctChars / 5 / minutes : 0;
  const cpm = minutes > 0 ? counters.correctChars / minutes : 0;
  const accuracy =
    counters.keystrokes > 0
      ? ((counters.keystrokes - counters.totalMistakes) / counters.keystrokes) * 100
      : 100;

  const processedLines = state.linesCompleted + state.linesMissed;
  const completion =
    ctx.totalLines > 0 ? Math.min(100, (processedLines / ctx.totalLines) * 100) : 0;

  const score = computeScore({
    correctChars: counters.correctChars,
    linesCompleted: state.linesCompleted,
    bestCombo: counters.bestCombo,
    accuracy,
    completion,
    mode: ctx.mode,
    tempoRate: ctx.tempoRate,
  });

  return {
    wpm: round1(wpm),
    cpm: round1(cpm),
    accuracy: round2(accuracy),
    correctChars: counters.correctChars,
    incorrectChars: counters.incorrectChars,
    totalMistakes: counters.totalMistakes,
    combo: counters.combo,
    bestCombo: counters.bestCombo,
    score,
    completion: round2(completion),
    elapsedMs: Math.max(0, Math.round(ctx.elapsedMs)),
    linesCompleted: state.linesCompleted,
    totalLines: ctx.totalLines,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

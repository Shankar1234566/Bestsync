/**
 * Typing game orchestration — binds the shared typing engine to lyrics,
 * playback time and game modes.
 *
 * Mode rules:
 * - practice / free : sequential typing; highlight follows your typing;
 *   playback position is informational.
 * - beat / challenge / battle : playback drives the active line; missing a
 *   line before the song moves on counts it as "passed" (missed). Finishing
 *   a line early waits for the next beat. The player's clock is the only
 *   source of truth — pause, resume and seek all re-sync automatically.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, RefObject } from 'react';
import {
  activeLineIndex,
  computeStats,
  createTypingState,
  finalizeLine,
  isLineComplete,
  parseLyricsInput,
  typingBackspace,
  typingInput,
  type GameMode,
  type LiveStats,
  type LyricDocument,
  type SessionResult,
} from '../../shared';
import type { UsePlayer } from '../music/usePlayer';

export type GamePhase = 'idle' | 'playing' | 'paused' | 'finished';

export interface GameOptions {
  mode: GameMode;
  player: UsePlayer | null;
  songUrl: string | null;
  songTitle: string | null;
  tempoRate: number;
  adaptiveTempo: boolean;
  onComplete?: (result: SessionResult) => void;
  /** Called whenever live accuracy changes (feeds Adaptive Tempo). */
  onAccuracy?: (accuracy: number) => void;
}

const ZERO_STATS: LiveStats = {
  wpm: 0,
  cpm: 0,
  accuracy: 100,
  correctChars: 0,
  incorrectChars: 0,
  totalMistakes: 0,
  combo: 0,
  bestCombo: 0,
  score: 0,
  completion: 0,
  elapsedMs: 0,
  linesCompleted: 0,
  totalLines: 0,
};

const HUD_TICK_MS = 250;
const SYNC_TICK_MS = 200;

export interface TypingGameHandle {
  doc: LyricDocument;
  setLyrics: (text: string) => void;
  lineIndex: number;
  activeText: string;
  nextText: string | null;
  typed: string;
  stats: LiveStats;
  phase: GamePhase;
  elapsedMs: number;
  /** Increments on every accepted keystroke; ok=false means a mistake. */
  feedback: { seq: number; ok: boolean } | null;
  inputRef: RefObject<HTMLInputElement | null>;
  onInputKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onInputBeforeInput: (event: FormEvent<HTMLInputElement>) => void;
  onInputPaste: (event: React.ClipboardEvent<HTMLInputElement>) => void;
  finish: (reason?: string) => void;
  reset: () => void;
  togglePause: () => void;
  isPlaybackDriven: boolean;
  waitingForBeat: boolean;
}

export function useTypingGame(options: GameOptions): TypingGameHandle {
  const { mode, player, songUrl, songTitle, tempoRate, adaptiveTempo, onComplete, onAccuracy } =
    options;

  const [doc, setDoc] = useState<LyricDocument>({ lines: [], timed: false, metadata: {} });
  const [lineIndex, setLineIndex] = useState(0);
  const [phase, setPhaseState] = useState<GamePhase>('idle');
  const [stats, setStats] = useState<LiveStats>(ZERO_STATS);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [feedback, setFeedback] = useState<{ seq: number; ok: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const typingRef = useRef(createTypingState());
  const startedAtRef = useRef<number | null>(null);
  const pausedAtRef = useRef<number | null>(null);
  const pausedTotalRef = useRef(0);
  const phaseRef = useRef<GamePhase>('idle');
  const lineIndexRef = useRef(0);
  const docRef = useRef<LyricDocument>(doc);
  const finishedRef = useRef(false);
  const lastInputAtRef = useRef(0);
  const keystrokeSeqRef = useRef(0);

  const isPlaybackDriven = mode === 'beat' || mode === 'challenge' || mode === 'battle';
  const activeText = doc.lines[lineIndex]?.text ?? '';
  const nextText = doc.lines[lineIndex + 1]?.text ?? null;
  const typed = typingRef.current.typed;

  const setPhase = useCallback((next: GamePhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const setLine = useCallback((next: number) => {
    lineIndexRef.current = next;
    setLineIndex(next);
  }, []);

  const currentElapsed = useCallback((): number => {
    if (startedAtRef.current === null) return 0;
    const now = Date.now();
    const openPause = pausedAtRef.current !== null ? now - pausedAtRef.current : 0;
    return Math.max(0, now - startedAtRef.current - pausedTotalRef.current - openPause);
  }, []);

  const recompute = useCallback(() => {
    const elapsed = currentElapsed();
    const next = computeStats(typingRef.current, {
      elapsedMs: elapsed,
      totalLines: docRef.current.lines.length,
      mode,
      tempoRate,
    });
    setStats(next);
    onAccuracy?.(next.accuracy);
    return next;
  }, [currentElapsed, mode, tempoRate, onAccuracy]);

  /* ------------------------------ lifecycle ----------------------------- */

  const beginClock = useCallback(() => {
    if (startedAtRef.current !== null) return;
    startedAtRef.current = Date.now();
  }, []);

  const finish = useCallback(
    (reason = 'manual') => {
      if (finishedRef.current) return;
      finishedRef.current = true;

      if (pausedAtRef.current !== null) {
        pausedTotalRef.current += Date.now() - pausedAtRef.current;
        pausedAtRef.current = null;
      }

      const elapsed = currentElapsed();
      const finalStats = computeStats(typingRef.current, {
        elapsedMs: elapsed,
        totalLines: docRef.current.lines.length,
        mode,
        tempoRate,
      });
      setElapsedMs(elapsed);
      setStats(finalStats);
      onAccuracy?.(finalStats.accuracy);
      setPhase('finished');
      void reason;

      onComplete?.({
        ...finalStats,
        mode,
        tempoRate,
        adaptiveTempo,
        songUrl,
        songTitle,
        keystrokes: typingRef.current.counters.keystrokes,
        linesMissed: typingRef.current.linesMissed,
      });
    },
    [currentElapsed, mode, tempoRate, adaptiveTempo, songUrl, songTitle, onComplete, onAccuracy, setPhase],
  );

  const reset = useCallback(() => {
    typingRef.current = createTypingState();
    startedAtRef.current = null;
    pausedAtRef.current = null;
    pausedTotalRef.current = 0;
    finishedRef.current = false;
    lastInputAtRef.current = 0;
    keystrokeSeqRef.current = 0;
    setLine(0);
    setPhase('idle');
    setElapsedMs(0);
    setStats(ZERO_STATS);
    setFeedback(null);
    inputRef.current?.focus();
  }, [setLine, setPhase]);

  const setLyrics = useCallback(
    (text: string) => {
      const parsed = parseLyricsInput(text);
      docRef.current = parsed;
      setDoc(parsed);
      reset();
    },
    [reset],
  );

  /* ------------------------------ keystrokes ---------------------------- */

  const applyChar = useCallback(
    (char: string) => {
      if (finishedRef.current || phaseRef.current === 'paused') return;
      const target = docRef.current.lines[lineIndexRef.current]?.text;
      if (target === undefined || target.length === 0) return;

      if (phaseRef.current === 'idle') {
        beginClock();
        setPhase('playing');
      }

      const position = typingRef.current.typed.length;
      const expected = target[position];
      const result = typingInput(typingRef.current, target, char);

      if (result === 'ignored') return;

      keystrokeSeqRef.current += 1;
      setFeedback({ seq: keystrokeSeqRef.current, ok: char === expected });

      if (result === 'line-complete' && !isPlaybackDriven) {
        finalizeLine(typingRef.current, target, 'completed');
        const next = lineIndexRef.current + 1;
        setLine(next);
        if (next >= docRef.current.lines.length) {
          recompute();
          finish('all-lines');
          return;
        }
      }

      recompute();
    },
    [beginClock, finish, isPlaybackDriven, recompute, setLine, setPhase],
  );

  const applyBackspace = useCallback(() => {
    if (finishedRef.current || phaseRef.current === 'paused') return;
    const target = docRef.current.lines[lineIndexRef.current]?.text;
    if (target === undefined) return;
    if (typingBackspace(typingRef.current, target)) recompute();
  }, [recompute]);

  /* --------------------------- playback sync ---------------------------- */

  const advancePlaybackTo = useCallback(
    (target: number) => {
      const lines = docRef.current.lines;
      const current = Math.max(0, lineIndexRef.current);
      if (target <= current) return;
      for (let i = current; i < target && i < lines.length; i += 1) {
        const text = lines[i].text;
        const complete = isLineComplete(typingRef.current, text);
        finalizeLine(typingRef.current, text, complete ? 'completed' : 'passed');
      }
      setLine(Math.max(0, Math.min(target, lines.length)));
      recompute();
    },
    [recompute, setLine],
  );

  const rewindPlaybackTo = useCallback(
    (target: number) => {
      const safeTarget = Math.max(0, target);
      const text = docRef.current.lines[lineIndexRef.current]?.text ?? '';
      while (typingRef.current.typed.length > 0) {
        typingBackspace(typingRef.current, text);
      }
      setLine(safeTarget);
      recompute();
    },
    [recompute, setLine],
  );

  // Playback-driven line highlighting: poll the player's own clock.
  useEffect(() => {
    if (!isPlaybackDriven || !doc.timed || !player) return;
    const timer = window.setInterval(() => {
      if (finishedRef.current || phaseRef.current === 'paused') return;
      const idx = activeLineIndex(docRef.current, player.now() * 1000);
      if (idx === null) return;
      // -1 means "before the first line" — clamp to line 0.
      const target = Math.max(0, idx);
      const current = lineIndexRef.current;
      if (target > current) advancePlaybackTo(target);
      else if (target < current) rewindPlaybackTo(target);
    }, SYNC_TICK_MS);
    return () => window.clearInterval(timer);
  }, [isPlaybackDriven, doc.timed, player, advancePlaybackTo, rewindPlaybackTo]);

  // Song ended → close out whatever remains.
  const playerStatus = player?.state.status;
  useEffect(() => {
    if (!player || playerStatus !== 'ended') return;
    if (finishedRef.current) return;
    if (isPlaybackDriven && docRef.current.timed) {
      advancePlaybackTo(docRef.current.lines.length);
    }
    finish('song-ended');
  }, [player, playerStatus, isPlaybackDriven, advancePlaybackTo, finish]);

  // HUD clock: keeps elapsed time and derived stats fresh while playing.
  useEffect(() => {
    if (phase !== 'playing') return;
    const timer = window.setInterval(() => {
      if (finishedRef.current) return;
      setElapsedMs(currentElapsed());
      recompute();
    }, HUD_TICK_MS);
    return () => window.clearInterval(timer);
  }, [phase, currentElapsed, recompute]);

  /* -------------------------------- input ------------------------------ */

  const onInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (finishedRef.current) return;
      if (event.key === 'Backspace') {
        event.preventDefault();
        lastInputAtRef.current = Date.now();
        applyBackspace();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Enter' || event.key === 'Tab') return;
      if (event.key.length === 1) {
        event.preventDefault();
        lastInputAtRef.current = Date.now();
        applyChar(event.key);
      }
    },
    [applyChar, applyBackspace],
  );

  // Mobile keyboards often skip keydown — beforeinput is the fallback.
  const onInputBeforeInput = useCallback(
    (event: FormEvent<HTMLInputElement>) => {
      const native = event.nativeEvent as InputEvent;
      if (Date.now() - lastInputAtRef.current < 70) {
        event.preventDefault();
        return;
      }
      if (native.inputType === 'insertText' && typeof native.data === 'string') {
        event.preventDefault();
        if (native.data.length === 1) applyChar(native.data);
      } else if (native.inputType === 'deleteContentBackspace') {
        event.preventDefault();
        applyBackspace();
      } else {
        event.preventDefault(); // block paste / autocorrect injections
      }
    },
    [applyChar, applyBackspace],
  );

  const onInputPaste = useCallback((event: React.ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
  }, []);

  /* ------------------------------- controls ---------------------------- */

  const togglePause = useCallback(() => {
    if (finishedRef.current || startedAtRef.current === null) return;
    if (phaseRef.current === 'playing') {
      pausedAtRef.current = Date.now();
      setPhase('paused');
      player?.pause();
    } else if (phaseRef.current === 'paused') {
      pausedTotalRef.current += Date.now() - (pausedAtRef.current ?? Date.now());
      pausedAtRef.current = null;
      setPhase('playing');
      void player?.play();
      inputRef.current?.focus();
    }
  }, [player, setPhase]);

  const waitingForBeat = useMemo(() => {
    if (!isPlaybackDriven || !doc.timed) return false;
    return (
      phase !== 'finished' &&
      activeText.length > 0 &&
      typingRef.current.typed.length >= activeText.length
    );
  }, [isPlaybackDriven, doc.timed, phase, activeText]);

  return {
    doc,
    setLyrics,
    lineIndex,
    activeText,
    nextText,
    typed,
    stats,
    phase,
    elapsedMs,
    feedback,
    inputRef,
    onInputKeyDown,
    onInputBeforeInput,
    onInputPaste,
    finish,
    reset,
    togglePause,
    isPlaybackDriven,
    waitingForBeat,
  };
}

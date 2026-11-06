import { describe, expect, it } from 'vitest';
import {
  computeScore,
  computeStats,
  createTypingState,
  finalizeLine,
  isLineComplete,
  typingBackspace,
  typingInput,
} from '../src/shared';

describe('typingInput', () => {
  it('accepts correct characters and tracks combo', () => {
    const state = createTypingState();
    expect(typingInput(state, 'hello', 'h')).toBe('accepted');
    expect(typingInput(state, 'hello', 'e')).toBe('accepted');
    expect(state.typed).toBe('he');
    expect(state.counters.keystrokes).toBe(2);
    expect(state.counters.correctChars).toBe(2);
    expect(state.counters.combo).toBe(2);
    expect(state.counters.bestCombo).toBe(2);
    expect(state.counters.totalMistakes).toBe(0);
  });

  it('counts a wrong character as a mistake and resets combo', () => {
    const state = createTypingState();
    typingInput(state, 'hello', 'h');
    typingInput(state, 'hello', 'x');
    expect(state.counters.totalMistakes).toBe(1);
    expect(state.counters.combo).toBe(0);
    expect(state.counters.bestCombo).toBe(1);
    expect(state.counters.incorrectChars).toBe(1);
    expect(state.counters.correctChars).toBe(1);
  });

  it('reports line-complete on the final character', () => {
    const state = createTypingState();
    expect(typingInput(state, 'hi', 'h')).toBe('accepted');
    expect(typingInput(state, 'hi', 'i')).toBe('line-complete');
    expect(isLineComplete(state, 'hi')).toBe(true);
  });

  it('ignores control characters and input past the line end', () => {
    const state = createTypingState();
    expect(typingInput(state, 'ab', '\n')).toBe('ignored');
    expect(typingInput(state, 'ab', '\t')).toBe('ignored');
    expect(typingInput(state, 'ab', 'a')).toBe('accepted');
    expect(typingInput(state, 'ab', 'b')).toBe('line-complete');
    expect(typingInput(state, 'ab', 'c')).toBe('ignored');
    expect(state.counters.keystrokes).toBe(2);
  });
});

describe('typingBackspace', () => {
  it('lowers live correct characters (no WPM gaming) but keeps mistakes', () => {
    const state = createTypingState();
    typingInput(state, 'hello', 'h');
    typingInput(state, 'hello', 'x');
    expect(state.counters.correctChars).toBe(1);
    expect(state.counters.totalMistakes).toBe(1);

    expect(typingBackspace(state, 'hello')).toBe(true);
    expect(state.typed).toBe('h');
    expect(state.counters.correctChars).toBe(1);
    expect(state.counters.totalMistakes).toBe(1); // mistakes never decrease

    expect(typingBackspace(state, 'hello')).toBe(true);
    expect(state.typed).toBe('');
    expect(state.counters.correctChars).toBe(0);
    expect(state.counters.backspaces).toBe(2);
  });

  it('returns false on an empty line', () => {
    const state = createTypingState();
    expect(typingBackspace(state, 'hello')).toBe(false);
  });
});

describe('finalizeLine', () => {
  it('freezes completed lines into cumulative counters', () => {
    const state = createTypingState();
    for (const ch of 'abc') typingInput(state, 'abc', ch);
    finalizeLine(state, 'abc', 'completed');
    expect(state.linesCompleted).toBe(1);
    expect(state.typed).toBe('');
    expect(state.counters.correctChars).toBe(3);
    expect(state.completedCorrectChars).toBe(3);
    expect(state.counters.incorrectChars).toBe(0);
  });

  it('counts passed (missed) lines separately', () => {
    const state = createTypingState();
    typingInput(state, 'abcdef', 'a');
    finalizeLine(state, 'abcdef', 'passed');
    expect(state.linesMissed).toBe(1);
    expect(state.linesCompleted).toBe(0);
    // Partial correct characters still count toward the score.
    expect(state.counters.correctChars).toBe(1);
  });

  it('resets the active line for the next target', () => {
    const state = createTypingState();
    for (const ch of 'ab') typingInput(state, 'ab', ch);
    finalizeLine(state, 'ab', 'completed');
    expect(typingInput(state, 'cd', 'c')).toBe('accepted');
    expect(state.counters.correctChars).toBe(3);
  });
});

describe('computeStats', () => {
  const ctx = { elapsedMs: 60_000, totalLines: 1, mode: 'practice' as const, tempoRate: 1 };

  it('computes WPM with the five-character convention', () => {
    const state = createTypingState();
    for (const ch of 'hello') typingInput(state, 'hello', ch);
    const stats = computeStats(state, ctx);
    // 5 correct chars over 1 minute → 5/5 = 1 WPM.
    expect(stats.wpm).toBe(1);
    expect(stats.cpm).toBe(5);
    expect(stats.accuracy).toBe(100);
    expect(stats.combo).toBe(5);
    expect(stats.bestCombo).toBe(5);
    expect(stats.score).toBe(
      computeScore({
        correctChars: 5,
        linesCompleted: 0,
        bestCombo: 5,
        accuracy: 100,
        completion: 0,
        mode: 'practice',
        tempoRate: 1,
      }),
    );
  });

  it('derives accuracy from keystrokes and cumulative mistakes', () => {
    const state = createTypingState();
    const target = 'a'.repeat(10);
    for (let i = 0; i < 9; i += 1) typingInput(state, target, 'a');
    typingInput(state, target, 'x'); // 10th keystroke is wrong
    const stats = computeStats(state, ctx);
    expect(stats.accuracy).toBe(90);
    expect(stats.totalMistakes).toBe(1);
  });

  it('reports completion from processed lines', () => {
    const state = createTypingState();
    finalizeLine(state, 'a', 'completed');
    finalizeLine(state, 'b', 'passed');
    finalizeLine(state, 'c', 'completed');
    const stats = computeStats(state, { ...ctx, totalLines: 4 });
    expect(stats.completion).toBe(75);
    expect(stats.linesCompleted).toBe(2);
  });

  it('returns zeros before any input', () => {
    const stats = computeStats(createTypingState(), ctx);
    expect(stats.wpm).toBe(0);
    expect(stats.cpm).toBe(0);
    expect(stats.accuracy).toBe(100);
    expect(stats.completion).toBe(0);
  });
});

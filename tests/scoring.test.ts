import { describe, expect, it } from 'vitest';
import { computeScore, validateScorePlausibility } from '../src/shared';

describe('computeScore', () => {
  it('matches the documented reference example (720 points)', () => {
    const score = computeScore({
      correctChars: 150,
      linesCompleted: 10,
      bestCombo: 40,
      accuracy: 100,
      completion: 100,
      mode: 'practice',
      tempoRate: 1,
    });
    // base = 150 + 10*25 + 40*3 + 100*2 = 720; factors all 1.
    expect(score).toBe(720);
  });

  it('applies the mode multiplier', () => {
    const base = { correctChars: 150, linesCompleted: 10, bestCombo: 40, accuracy: 100, completion: 100, tempoRate: 1 };
    expect(computeScore({ ...base, mode: 'practice' })).toBe(720);
    expect(computeScore({ ...base, mode: 'free' })).toBe(576); // 720 * 0.8
    expect(computeScore({ ...base, mode: 'beat' })).toBe(900); // 720 * 1.25
    expect(computeScore({ ...base, mode: 'challenge' })).toBe(1080); // 720 * 1.5
    expect(computeScore({ ...base, mode: 'battle' })).toBe(1080); // 720 * 1.5
  });

  it('squares the accuracy factor', () => {
    const base = { correctChars: 100, linesCompleted: 0, bestCombo: 0, completion: 0, mode: 'practice' as const, tempoRate: 1 };
    expect(computeScore({ ...base, accuracy: 100 })).toBe(100);
    expect(computeScore({ ...base, accuracy: 50 })).toBe(25); // 100 * 0.5^2
  });

  it('rewards higher tempo modestly (max +25%)', () => {
    const base = { correctChars: 100, linesCompleted: 0, bestCombo: 0, accuracy: 100, completion: 0, mode: 'practice' as const };
    expect(computeScore({ ...base, tempoRate: 1 })).toBe(100);
    expect(computeScore({ ...base, tempoRate: 1.5 })).toBe(125);
    expect(computeScore({ ...base, tempoRate: 0.5 })).toBe(75);
  });

  it('never returns a negative score and clamps out-of-range inputs', () => {
    const score = computeScore({
      correctChars: -50,
      linesCompleted: -1,
      bestCombo: -10,
      accuracy: 150,
      completion: -20,
      mode: 'practice',
      tempoRate: 9,
    });
    expect(score).toBe(0); // base clamps to 0
  });
});

describe('validateScorePlausibility', () => {
  const plausible = {
    wpm: 60,
    cpm: 300,
    accuracy: 95,
    correctChars: 300,
    totalMistakes: 15,
    keystrokes: 315,
    score: 379,
    completion: 80,
    elapsedMs: 60_000,
    mode: 'practice' as const,
    tempoRate: 1,
  };

  it('accepts a consistent human session', () => {
    expect(validateScorePlausibility(plausible)).toBeNull();
  });

  it('rejects impossible WPM', () => {
    expect(validateScorePlausibility({ ...plausible, wpm: 400 })).toMatch(/350/);
    expect(validateScorePlausibility({ ...plausible, wpm: -5 })).toMatch(/non-negative/);
  });

  it('rejects sessions shorter than the minimum duration', () => {
    expect(validateScorePlausibility({ ...plausible, elapsedMs: 4_000 })).toMatch(/too short/i);
    expect(validateScorePlausibility({ ...plausible, elapsedMs: 4 * 60 * 60 * 1_000 })).toMatch(
      /implausibly long/i,
    );
  });

  it('rejects WPM that does not match chars/duration', () => {
    // 300 chars in 60s ⇒ 60 WPM; reporting 100 is inconsistent.
    expect(validateScorePlausibility({ ...plausible, wpm: 100 })).toMatch(/does not match/);
  });

  it('rejects accuracy that does not match keystroke counters', () => {
    expect(
      validateScorePlausibility({ ...plausible, accuracy: 99, totalMistakes: 100, keystrokes: 400 }),
    ).toMatch(/accuracy does not match/i);
  });

  it('rejects out-of-range accuracy and completion', () => {
    expect(validateScorePlausibility({ ...plausible, accuracy: 120 })).toMatch(/between 0 and 100/);
    expect(validateScorePlausibility({ ...plausible, completion: 150 })).toMatch(/Completion/);
  });

  it('rejects negative counters', () => {
    expect(validateScorePlausibility({ ...plausible, correctChars: -1 })).toMatch(/cannot be negative/);
  });
});

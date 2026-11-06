import { describe, expect, it } from 'vitest';
import {
  ADAPTIVE_STEP,
  DEFAULT_ADAPTIVE_CONFIG,
  TEMPO_PRESETS,
  adaptiveDecision,
  clampRate,
  rateForMode,
  smoothRate,
  type AdaptiveTempoConfig,
} from '../src/shared';

const config: AdaptiveTempoConfig = { enabled: true, minRate: 0.5, maxRate: 1.5 };

describe('clampRate', () => {
  it('clamps into the custom range', () => {
    expect(clampRate(2)).toBe(1.5);
    expect(clampRate(0.1)).toBe(0.5);
    expect(clampRate(1.2)).toBe(1.2);
  });

  it('honours explicit bounds and non-finite input', () => {
    expect(clampRate(0.8, 0.75, 1.25)).toBe(0.8);
    expect(clampRate(0.9, 1, 1.25)).toBe(1);
    expect(clampRate(Number.NaN)).toBe(1);
    expect(clampRate(Infinity)).toBe(1);
  });
});

describe('rateForMode', () => {
  it('returns preset rates for slow/normal/fast', () => {
    expect(rateForMode('slow', 1)).toBe(TEMPO_PRESETS.slow);
    expect(rateForMode('normal', 1)).toBe(1);
    expect(rateForMode('fast', 1)).toBe(TEMPO_PRESETS.fast);
  });

  it('clamps the custom rate', () => {
    expect(rateForMode('custom', 1.4)).toBe(1.4);
    expect(rateForMode('custom', 3)).toBe(1.5);
    expect(rateForMode('custom', 0)).toBe(0.5);
  });
});

describe('adaptiveDecision', () => {
  it('maintains when disabled', () => {
    const decision = adaptiveDecision(1.2, 50, { ...DEFAULT_ADAPTIVE_CONFIG, enabled: false });
    expect(decision.action).toBe('maintain');
    expect(decision.targetRate).toBe(1.2);
    expect(decision.message).toMatch(/off/i);
  });

  it('slows down below 60% accuracy', () => {
    const decision = adaptiveDecision(1.0, 55, config);
    expect(decision.action).toBe('decrease');
    expect(decision.targetRate).toBeCloseTo(1.0 - ADAPTIVE_STEP, 5);
    expect(decision.message).toMatch(/slowing down/i);
  });

  it('holds between 60% and 80% accuracy', () => {
    for (const accuracy of [60, 79]) {
      const decision = adaptiveDecision(1.1, accuracy, config);
      expect(decision.action).toBe('maintain');
      expect(decision.targetRate).toBe(1.1);
    }
  });

  it('speeds up between 80% and 95% accuracy', () => {
    const decision = adaptiveDecision(1.0, 85, config);
    expect(decision.action).toBe('increase');
    expect(decision.targetRate).toBeCloseTo(1.0 + ADAPTIVE_STEP, 5);
    expect(decision.message).toMatch(/speeding up/i);
  });

  it('allows a faster push above 95% accuracy', () => {
    const decision = adaptiveDecision(1.0, 99, config);
    expect(decision.action).toBe('allow-faster');
    expect(decision.targetRate).toBeCloseTo(1.0 + ADAPTIVE_STEP * 2, 5);
    expect(decision.message).toMatch(/flying/i);
  });

  it('never leaves the configured rate window', () => {
    const slow = adaptiveDecision(0.5, 10, config);
    expect(slow.targetRate).toBe(0.5);
    expect(slow.message).toMatch(/minimum/i);

    const fast = adaptiveDecision(1.5, 99, config);
    expect(fast.targetRate).toBe(1.5);
    expect(fast.message).toMatch(/maximum/i);
  });
});

describe('smoothRate', () => {
  it('moves toward the target without exceeding the max step per second', () => {
    expect(smoothRate(1, 1.5, 1_000, 0.35)).toBeCloseTo(1.35, 5);
    expect(smoothRate(1, 1.5, 500, 0.35)).toBeCloseTo(1.175, 5);
  });

  it('snaps when the target is within one step', () => {
    expect(smoothRate(1, 1.1, 1_000, 0.35)).toBe(1.1);
    expect(smoothRate(1, 1, 250, 0.35)).toBe(1);
  });

  it('handles non-finite inputs gracefully', () => {
    expect(smoothRate(Number.NaN, 1.2, 250)).toBe(1.2);
    expect(smoothRate(1, Number.NaN, 250)).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import {
  ALL_CHALLENGES,
  DAILY_CHALLENGES,
  WEEKLY_CHALLENGES,
  challengeById,
  clampProgress,
  isChallengeCompleted,
  isHighWaterMetric,
  nextProgress,
  periodKey,
} from '../src/shared';

describe('challenge definitions', () => {
  it('has four daily and five weekly challenges with unique ids', () => {
    expect(DAILY_CHALLENGES).toHaveLength(4);
    expect(WEEKLY_CHALLENGES).toHaveLength(5);
    expect(ALL_CHALLENGES).toHaveLength(9);
    expect(new Set(ALL_CHALLENGES.map((c) => c.id)).size).toBe(9);
  });

  it('every challenge has a positive target, reward and kind', () => {
    for (const challenge of ALL_CHALLENGES) {
      expect(challenge.target).toBeGreaterThan(0);
      expect(challenge.xpReward).toBeGreaterThan(0);
      expect(challenge.kind).toBe(challenge.id.startsWith('daily') ? 'daily' : 'weekly');
      expect(challenge.description.length).toBeGreaterThan(0);
    }
  });

  it('accuracy challenges declare a threshold', () => {
    const accuracyChallenges = ALL_CHALLENGES.filter((c) => c.metric === 'accuracySessions');
    expect(accuracyChallenges.length).toBeGreaterThan(0);
    for (const challenge of accuracyChallenges) {
      expect(challenge.threshold).toBeGreaterThan(0);
    }
  });

  it('resolves challenges by id', () => {
    expect(challengeById('daily-chars')?.title).toBe('Finger Warm-up');
    expect(challengeById('weekly-speed')?.target).toBe(120);
    expect(challengeById('nope')).toBeUndefined();
  });
});

describe('progress math', () => {
  it('classifies high-water metrics', () => {
    expect(isHighWaterMetric('bestCombo')).toBe(true);
    expect(isHighWaterMetric('bestWpm')).toBe(true);
    expect(isHighWaterMetric('daysActive')).toBe(true);
    expect(isHighWaterMetric('charsTyped')).toBe(false);
    expect(isHighWaterMetric('songsCompleted')).toBe(false);
    expect(isHighWaterMetric('accuracySessions')).toBe(false);
  });

  it('high-water metrics keep the maximum value', () => {
    expect(nextProgress(30, 'bestCombo', 20)).toBe(30);
    expect(nextProgress(30, 'bestCombo', 45)).toBe(45);
    expect(nextProgress(100, 'bestWpm', 90)).toBe(100);
  });

  it('cumulative metrics add deltas and ignore negatives', () => {
    expect(nextProgress(100, 'charsTyped', 50)).toBe(150);
    expect(nextProgress(100, 'charsTyped', -50)).toBe(100);
    expect(nextProgress(0, 'songsCompleted', 3)).toBe(3);
  });

  it('clamps progress at the target and detects completion', () => {
    expect(clampProgress(600, 500)).toBe(500);
    expect(clampProgress(400, 500)).toBe(400);
    expect(isChallengeCompleted(500, 500)).toBe(true);
    expect(isChallengeCompleted(499, 500)).toBe(false);
  });
});

describe('periodKey', () => {
  it('builds a stable day key in local time', () => {
    expect(periodKey('daily', new Date(2026, 10, 5))).toBe('d:2026-11-05');
    expect(periodKey('daily', new Date(2026, 0, 1))).toBe('d:2026-01-01');
  });

  it('builds an ISO week key', () => {
    // 2026-11-05 is a Thursday in ISO week 45.
    expect(periodKey('weekly', new Date(Date.UTC(2026, 10, 5)))).toBe('w:2026-W45');
    // The same ISO week is shared by its Sunday..Saturday neighbours.
    expect(periodKey('weekly', new Date(Date.UTC(2026, 10, 8)))).toBe('w:2026-W45');
    expect(periodKey('weekly', new Date(Date.UTC(2026, 10, 1)))).toBe('w:2026-W44');
  });

  it('never mixes day and weekly namespaces', () => {
    const date = new Date(2026, 10, 5);
    expect(periodKey('daily', date)).not.toBe(periodKey('weekly', date));
  });
});

import { describe, expect, it } from 'vitest';
import { LEADERBOARD_SCOPES, compareEntries, rankEntries, scopeWindow } from '../src/shared';

describe('compareEntries', () => {
  const entry = (score: number, accuracy: number, wpm: number) => ({ score, accuracy, wpm });

  it('orders by score descending', () => {
    expect(compareEntries(entry(100, 90, 50), entry(200, 90, 50))).toBeGreaterThan(0);
    expect(compareEntries(entry(200, 90, 50), entry(100, 90, 50))).toBeLessThan(0);
  });

  it('breaks score ties with accuracy', () => {
    expect(compareEntries(entry(100, 95, 50), entry(100, 90, 99))).toBeLessThan(0);
    expect(compareEntries(entry(100, 90, 50), entry(100, 95, 10))).toBeGreaterThan(0);
  });

  it('breaks remaining ties with WPM', () => {
    expect(compareEntries(entry(100, 90, 80), entry(100, 90, 60))).toBeLessThan(0);
    expect(compareEntries(entry(100, 90, 60), entry(100, 90, 80))).toBeGreaterThan(0);
    expect(compareEntries(entry(100, 90, 60), entry(100, 90, 60))).toBe(0);
  });
});

describe('rankEntries', () => {
  it('sorts and stamps 1-based ranks without mutating the input', () => {
    const input = [
      { name: 'low', score: 10, accuracy: 90, wpm: 40 },
      { name: 'high', score: 30, accuracy: 90, wpm: 40 },
      { name: 'mid', score: 20, accuracy: 90, wpm: 40 },
    ];
    const ranked = rankEntries(input);
    expect(ranked.map((r) => r.name)).toEqual(['high', 'mid', 'low']);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(input.map((r) => r.name)).toEqual(['low', 'high', 'mid']); // untouched
  });

  it('gives distinct ranks to tied entries in a stable order', () => {
    const ranked = rankEntries([
      { id: 'a', score: 5, accuracy: 90, wpm: 50 },
      { id: 'b', score: 5, accuracy: 90, wpm: 50 },
      { id: 'c', score: 5, accuracy: 90, wpm: 50 },
    ]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(new Set(ranked.map((r) => r.id)).size).toBe(3);
  });
});

describe('scopeWindow', () => {
  const now = 1_760_000_000_000;
  const day = 86_400_000;

  it('returns null (all time) for unbounded scopes', () => {
    for (const scope of ['global', 'country', 'friends', 'song'] as const) {
      expect(scopeWindow(scope, now)).toBeNull();
    }
  });

  it('returns a seven-day window for weekly', () => {
    expect(scopeWindow('weekly', now)).toEqual({ from: now - 7 * day, to: now });
  });

  it('returns a thirty-day window for monthly', () => {
    expect(scopeWindow('monthly', now)).toEqual({ from: now - 30 * day, to: now });
  });

  it('lists every supported scope exactly once', () => {
    expect(new Set(LEADERBOARD_SCOPES).size).toBe(LEADERBOARD_SCOPES.length);
    expect(LEADERBOARD_SCOPES).toContain('global');
    expect(LEADERBOARD_SCOPES).toContain('friends');
  });
});

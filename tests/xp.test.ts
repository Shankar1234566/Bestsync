import { describe, expect, it } from 'vitest';
import { LEVELS, MAX_LEVEL, computeXp, levelForXp, levelProgress, xpToNextLevel } from '../src/shared';

describe('levels', () => {
  it('defines ten ascending levels with unique thresholds', () => {
    expect(LEVELS).toHaveLength(10);
    expect(MAX_LEVEL).toBe(10);
    for (let i = 1; i < LEVELS.length; i += 1) {
      expect(LEVELS[i].level).toBe(LEVELS[i - 1].level + 1);
      expect(LEVELS[i].minXp).toBeGreaterThan(LEVELS[i - 1].minXp);
      expect(LEVELS[i].name.length).toBeGreaterThan(0);
    }
  });

  it('maps XP to the highest level reached', () => {
    expect(levelForXp(0).name).toBe('Beginner');
    expect(levelForXp(249).level).toBe(1);
    expect(levelForXp(250).level).toBe(2);
    expect(levelForXp(600).name).toBe('Rhythm Rookie');
    expect(levelForXp(21_999).level).toBe(9);
    expect(levelForXp(22_000).level).toBe(10);
    expect(levelForXp(1_000_000).level).toBe(10);
  });

  it('reports XP needed for the next level (0 at max)', () => {
    expect(xpToNextLevel(0)).toBe(250);
    expect(xpToNextLevel(249)).toBe(1);
    expect(xpToNextLevel(250)).toBe(350);
    expect(xpToNextLevel(22_000)).toBe(0);
  });

  it('reports progress through the current level as 0..100', () => {
    expect(levelProgress(0)).toBe(0);
    expect(levelProgress(125)).toBe(50); // halfway to 250
    expect(levelProgress(249.9)).toBeLessThan(100);
    expect(levelProgress(250)).toBe(0); // just entered level 2
    expect(levelProgress(22_000)).toBe(100);
  });
});

describe('computeXp', () => {
  it('awards base XP plus completion, accuracy and streak bonuses', () => {
    const xp = computeXp({ score: 720, completion: 100, accuracy: 100, bestCombo: 40, streak: 3 });
    // 72 + 50 (completion) + 75 (99%+) + 100 (perfect) + 30 (streak) = 327
    expect(xp).toBe(327);
  });

  it('caps the streak bonus at seven days', () => {
    const capped = computeXp({ score: 0, completion: 0, accuracy: 50, bestCombo: 0, streak: 30 });
    const seven = computeXp({ score: 0, completion: 0, accuracy: 50, bestCombo: 0, streak: 7 });
    expect(capped).toBe(seven);
    expect(capped).toBe(70);
  });

  it('adds the combo bonus at 50+', () => {
    const without = computeXp({ score: 0, completion: 0, accuracy: 50, bestCombo: 49, streak: 0 });
    const withCombo = computeXp({ score: 0, completion: 0, accuracy: 50, bestCombo: 50, streak: 0 });
    expect(without).toBe(0);
    expect(withCombo).toBe(40);
  });

  it('ignores negative scores', () => {
    expect(computeXp({ score: -100, completion: 0, accuracy: 0, bestCombo: 0, streak: 0 })).toBe(0);
  });
});

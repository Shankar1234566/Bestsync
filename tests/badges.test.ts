import { describe, expect, it } from 'vitest';
import { BADGES, BADGE_IDS, badgeById, evaluateBadges, type BadgeContext } from '../src/shared';

function ctx(overrides: Partial<BadgeContext> = {}): BadgeContext {
  return {
    session: {
      accuracy: 95,
      completion: 100,
      bestCombo: 10,
      wpm: 50,
      totalMistakes: 5,
      songsCompleted: 1,
      ...overrides.session,
    },
    profile: {
      totalSongsCompleted: 1,
      bestWpm: 50,
      cleanRuns: 0,
      streak: 1,
      ...overrides.profile,
    },
    rank: overrides.rank ?? null,
  };
}

describe('badge definitions', () => {
  it('has nine unique badges with icons and descriptions', () => {
    expect(BADGES).toHaveLength(9);
    expect(new Set(BADGE_IDS).size).toBe(BADGES.length);
    for (const badge of BADGES) {
      expect(badge.name.length).toBeGreaterThan(0);
      expect(badge.description.length).toBeGreaterThan(0);
      expect(badge.icon.length).toBeGreaterThan(0);
    }
  });

  it('resolves badges by id', () => {
    expect(badgeById('first-song')?.name).toBe('First Song');
    expect(badgeById('does-not-exist')).toBeUndefined();
  });
});

describe('evaluateBadges', () => {
  it('unlocks First Song after any completed song', () => {
    expect(evaluateBadges(ctx())).toEqual(['first-song']);
  });

  it('unlocks nothing when no song was completed and nothing else qualifies', () => {
    const context = ctx({
      session: { accuracy: 90, completion: 50, bestCombo: 5, wpm: 40, totalMistakes: 9, songsCompleted: 0 },
      profile: { totalSongsCompleted: 0, bestWpm: 40, cleanRuns: 0, streak: 0 },
    });
    expect(evaluateBadges(context)).toEqual([]);
  });

  it('unlocks Perfect Typist, Combo Master and Flawless on a perfect run', () => {
    const context = ctx({
      session: { accuracy: 100, completion: 100, bestCombo: 60, wpm: 80, totalMistakes: 0, songsCompleted: 1 },
      profile: { totalSongsCompleted: 1, bestWpm: 80, cleanRuns: 1, streak: 1 },
    });
    const unlocked = evaluateBadges(context);
    expect(unlocked).toContain('perfect-typist');
    expect(unlocked).toContain('combo-master');
    expect(unlocked).toContain('flawless');
    expect(unlocked).toContain('first-song');
    // 60 combo < 100 WPM → no speed badge
    expect(unlocked).not.toContain('speed-demon');
  });

  it('unlocks Speed Demon from the session WPM alone', () => {
    const context = ctx({
      session: { accuracy: 90, completion: 60, bestCombo: 12, wpm: 120, totalMistakes: 8, songsCompleted: 1 },
      profile: { totalSongsCompleted: 1, bestWpm: 50, cleanRuns: 0, streak: 1 },
    });
    expect(evaluateBadges(context)).toContain('speed-demon');
  });

  it('requires 99%+ accuracy AND full completion for Perfect Typist', () => {
    const almost = ctx({
      session: { accuracy: 98, completion: 100, bestCombo: 10, wpm: 50, totalMistakes: 3, songsCompleted: 1 },
    });
    expect(evaluateBadges(almost)).not.toContain('perfect-typist');

    const notFinished = ctx({
      session: { accuracy: 100, completion: 90, bestCombo: 10, wpm: 50, totalMistakes: 0, songsCompleted: 0 },
      profile: { totalSongsCompleted: 0, bestWpm: 50, cleanRuns: 0, streak: 1 },
    });
    expect(evaluateBadges(notFinished)).not.toContain('perfect-typist');
  });

  it('unlocks Global Star only for top-100 ranks', () => {
    expect(evaluateBadges(ctx({ rank: 100 }))).toContain('global-star');
    expect(evaluateBadges(ctx({ rank: 101 }))).not.toContain('global-star');
    expect(evaluateBadges(ctx({ rank: null }))).not.toContain('global-star');
  });

  it('unlocks profile-tenure badges', () => {
    const veteran = ctx({
      profile: { totalSongsCompleted: 30, bestWpm: 70, cleanRuns: 12, streak: 8 },
    });
    const unlocked = evaluateBadges(veteran);
    expect(unlocked).toContain('music-lover');
    expect(unlocked).toContain('teddy-favourite');
    expect(unlocked).toContain('daily-hero');
  });
});

/**
 * Levels and XP — ten named ranks shared by client (progress bars, toasts)
 * and server (authoritative XP awarding).
 */
import type { LevelDefinition } from './types';

export const LEVELS: LevelDefinition[] = [
  { level: 1, name: 'Beginner', minXp: 0 },
  { level: 2, name: 'Music Explorer', minXp: 250 },
  { level: 3, name: 'Rhythm Rookie', minXp: 600 },
  { level: 4, name: 'Lyric Learner', minXp: 1_200 },
  { level: 5, name: 'Beat Master', minXp: 2_400 },
  { level: 6, name: 'Rhythm Champion', minXp: 4_200 },
  { level: 7, name: 'Music Star', minXp: 6_800 },
  { level: 8, name: 'Superstar', minXp: 10_500 },
  { level: 9, name: 'Beat Legend', minXp: 15_500 },
  { level: 10, name: 'Global Champion', minXp: 22_000 },
];

export const MAX_LEVEL = LEVELS[LEVELS.length - 1].level;

/** Level achieved for a total XP amount. */
export function levelForXp(xp: number): LevelDefinition {
  let current = LEVELS[0];
  for (const level of LEVELS) {
    if (xp >= level.minXp) current = level;
    else break;
  }
  return current;
}

/** XP still needed to reach the next level (0 at max level). */
export function xpToNextLevel(xp: number): number {
  const current = levelForXp(xp);
  const next = LEVELS.find((l) => l.level === current.level + 1);
  if (!next) return 0;
  return Math.max(0, next.minXp - xp);
}

/** XP required at the start of the current level (for progress bars). */
export function currentLevelBaseXp(xp: number): number {
  return levelForXp(xp).minXp;
}

/** 0..100 progress through the current level. */
export function levelProgress(xp: number): number {
  const current = levelForXp(xp);
  const next = LEVELS.find((l) => l.level === current.level + 1);
  if (!next) return 100;
  const span = next.minXp - current.minXp;
  if (span <= 0) return 100;
  return Math.min(100, Math.max(0, ((xp - current.minXp) / span) * 100));
}

export interface XpInput {
  score: number;
  completion: number;
  accuracy: number;
  bestCombo: number;
  /** Player's daily streak before this run (server computed). */
  streak: number;
}

/**
 * XP gained for one completed run.
 * Base = score / 10, plus completion / accuracy / combo / streak bonuses.
 */
export function computeXp(input: XpInput): number {
  let xp = Math.round(Math.max(0, input.score) / 10);

  if (input.completion >= 100) xp += 50;
  if (input.accuracy >= 99) xp += 75;
  if (input.accuracy >= 100 && input.completion >= 100) xp += 100;
  if (input.bestCombo >= 50) xp += 40;
  xp += Math.min(input.streak, 7) * 10;

  return xp;
}

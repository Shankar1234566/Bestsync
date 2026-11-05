/**
 * Score computation — identical formula on client (live HUD) and server
 * (authoritative re-validation of submitted scores).
 */
import { MODE_SCORE_MULTIPLIER, SCORE_LIMITS, type GameMode } from './constants';

export interface ScoreInput {
  correctChars: number;
  linesCompleted: number;
  bestCombo: number;
  accuracy: number;
  /** 0..100 */
  completion: number;
  mode: GameMode;
  tempoRate: number;
}

/**
 * score = base * accuracy^2 * modeMultiplier * tempoMultiplier
 * where base rewards typed characters, completed lines and best combo.
 */
export function computeScore(input: ScoreInput): number {
  const correctChars = Math.max(0, input.correctChars);
  const linesCompleted = Math.max(0, input.linesCompleted);
  const bestCombo = Math.max(0, input.bestCombo);
  const accuracy = clamp(input.accuracy, 0, 100);
  const completion = clamp(input.completion, 0, 100);
  const modeMultiplier = MODE_SCORE_MULTIPLIER[input.mode] ?? 1;
  const tempoRate = clamp(input.tempoRate, 0.5, 1.5);

  const base = correctChars + linesCompleted * 25 + bestCombo * 3 + completion * 2;
  const accuracyFactor = Math.pow(accuracy / 100, 2);
  const tempoFactor = 1 + (tempoRate - 1) * 0.5;

  return Math.max(0, Math.round(base * accuracyFactor * modeMultiplier * tempoFactor));
}

/**
 * Server-side plausibility check. Returns null when the submission looks
 * humanly possible, otherwise a human-readable rejection reason.
 */
export function validateScorePlausibility(sub: {
  wpm: number;
  cpm: number;
  accuracy: number;
  correctChars: number;
  totalMistakes: number;
  keystrokes?: number;
  score: number;
  completion: number;
  elapsedMs: number;
  mode: GameMode;
  tempoRate: number;
}): string | null {
  if (!Number.isFinite(sub.wpm) || sub.wpm < 0) return 'WPM must be a non-negative number.';
  if (sub.wpm > SCORE_LIMITS.maxWpm) return `WPM above ${SCORE_LIMITS.maxWpm} is not plausible.`;
  if (!Number.isFinite(sub.accuracy) || sub.accuracy < 0 || sub.accuracy > 100) {
    return 'Accuracy must be between 0 and 100.';
  }
  if (sub.completion < 0 || sub.completion > 100) return 'Completion must be between 0 and 100.';
  if (sub.elapsedMs < SCORE_LIMITS.minSessionMs) {
    return `Session too short — at least ${SCORE_LIMITS.minSessionMs / 1000}s of play is required.`;
  }
  if (sub.elapsedMs > SCORE_LIMITS.maxSessionMs) return 'Session duration is implausibly long.';
  if (sub.correctChars < 0 || sub.totalMistakes < 0) return 'Character counters cannot be negative.';

  if (sub.cpm > SCORE_LIMITS.maxCpm) return `CPM above ${SCORE_LIMITS.maxCpm} is not plausible.`;

  // WPM must match the reported characters and duration (five-char convention).
  const minutes = sub.elapsedMs / 60_000;
  const derivedWpm = sub.correctChars / 5 / minutes;
  if (derivedWpm > 0) {
    const drift = Math.abs(sub.wpm - derivedWpm) / derivedWpm;
    if (drift > SCORE_LIMITS.wpmTolerance) {
      return 'Reported WPM does not match the reported characters and duration.';
    }
  } else if (sub.wpm > 0 && sub.correctChars === 0) {
    return 'Reported WPM without any correct characters.';
  }

  // Accuracy must match keystrokes/mistakes when both are supplied.
  const keystrokes = sub.keystrokes ?? sub.correctChars + sub.totalMistakes;
  if (keystrokes > 0) {
    const derivedAccuracy = ((keystrokes - sub.totalMistakes) / keystrokes) * 100;
    if (Math.abs(sub.accuracy - derivedAccuracy) > SCORE_LIMITS.accuracyTolerancePoints) {
      return 'Reported accuracy does not match the keystroke counters.';
    }
  }

  if (sub.score < 0 || !Number.isFinite(sub.score)) return 'Score must be a non-negative number.';

  // Exact score reproduction (needs linesCompleted/bestCombo) is performed by
  // the server's scoreService with the complete submission payload.
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

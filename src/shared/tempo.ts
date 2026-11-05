/**
 * Tempo control: fixed presets, custom speed, and Adaptive Tempo.
 *
 * The controller returns *target* rates; smoothing happens in
 * `smoothRate` so playback never jumps abruptly and lyric sync (which reads
 * the player's own clock) never breaks.
 */
export type TempoMode = 'slow' | 'normal' | 'fast' | 'custom';

export const TEMPO_PRESETS: Record<'slow' | 'normal' | 'fast', number> = {
  slow: 0.75,
  normal: 1,
  fast: 1.25,
};

export const CUSTOM_MIN_RATE = 0.5;
export const CUSTOM_MAX_RATE = 1.5;

export const TEMPO_MODE_OPTIONS: { mode: TempoMode; label: string; rate: number | null }[] = [
  { mode: 'slow', label: 'Slow 0.75x', rate: TEMPO_PRESETS.slow },
  { mode: 'normal', label: 'Normal 1.0x', rate: TEMPO_PRESETS.normal },
  { mode: 'fast', label: 'Fast 1.25x', rate: TEMPO_PRESETS.fast },
  { mode: 'custom', label: 'Custom', rate: null },
];

export interface AdaptiveTempoConfig {
  enabled: boolean;
  minRate: number;
  maxRate: number;
}

export const DEFAULT_ADAPTIVE_CONFIG: AdaptiveTempoConfig = {
  enabled: false,
  minRate: CUSTOM_MIN_RATE,
  maxRate: CUSTOM_MAX_RATE,
};

export const ADAPTIVE_STEP = 0.05;

export type AdaptiveAction = 'decrease' | 'maintain' | 'increase' | 'allow-faster';

export interface AdaptiveDecision {
  action: AdaptiveAction;
  /** New target rate after applying the step (clamped to min/max). */
  targetRate: number;
  message: string;
}

export function clampRate(rate: number, min = CUSTOM_MIN_RATE, max = CUSTOM_MAX_RATE): number {
  if (!Number.isFinite(rate)) return 1;
  return Math.min(max, Math.max(min, rate));
}

export function rateForMode(mode: TempoMode, customRate: number): number {
  if (mode === 'custom') return clampRate(customRate);
  return TEMPO_PRESETS[mode];
}

/**
 * Adaptive Tempo decision based on current accuracy:
 * - below 60%  : gradually reduce speed
 * - 60–80%     : maintain a comfortable speed
 * - 80–95%     : gradually increase speed
 * - above 95%  : allow faster practice
 */
export function adaptiveDecision(
  currentRate: number,
  accuracy: number,
  config: AdaptiveTempoConfig,
): AdaptiveDecision {
  const min = clampRate(config.minRate);
  const max = clampRate(config.maxRate, config.minRate, config.maxRate);
  const current = clampRate(currentRate, min, max);

  if (!config.enabled) {
    return {
      action: 'maintain',
      targetRate: current,
      message: 'Adaptive Tempo is off.',
    };
  }

  if (accuracy < 60) {
    const target = Math.max(min, current - ADAPTIVE_STEP);
    return {
      action: 'decrease',
      targetRate: target,
      message: target < current ? 'Slowing down — accuracy is below 60%.' : 'At minimum speed.',
    };
  }
  if (accuracy < 80) {
    return {
      action: 'maintain',
      targetRate: current,
      message: 'Holding a comfortable pace (60–80% accuracy).',
    };
  }
  if (accuracy < 95) {
    const target = Math.min(max, current + ADAPTIVE_STEP);
    return {
      action: 'increase',
      targetRate: target,
      message: target > current ? 'Speeding up — accuracy above 80%.' : 'At maximum speed.',
    };
  }
  const target = Math.min(max, current + ADAPTIVE_STEP * 2);
  return {
    action: 'allow-faster',
    targetRate: target,
    message: target > current ? 'Flying now — accuracy above 95%!' : 'At maximum speed.',
  };
}

/**
 * Exponential smoothing with a hard maximum step per second so playback-speed
 * changes stay musical and never jolt lyric synchronization.
 */
export function smoothRate(
  current: number,
  target: number,
  deltaMs: number,
  maxStepPerSecond = 0.35,
): number {
  if (!Number.isFinite(current)) return target;
  if (!Number.isFinite(target)) return current;
  const dt = Math.max(0, deltaMs) / 1000;
  const maxDelta = maxStepPerSecond * dt;
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}

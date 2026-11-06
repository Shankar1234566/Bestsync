/**
 * Tempo controller: presets (0.75x / 1.0x / 1.25x), custom 0.5–1.5x and
 * Adaptive Tempo. Speed changes are smoothed (max 0.35 steps/second) so
 * playback never jolts — lyric sync reads the player clock, never the rate.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_ADAPTIVE_CONFIG,
  adaptiveDecision,
  clampRate,
  rateForMode,
  smoothRate,
  type AdaptiveAction,
  type AdaptiveTempoConfig,
  type TempoMode,
} from '../../shared';
import type { UsePlayer } from '../music/usePlayer';

const SMOOTH_TICK_MS = 250;
const MAX_STEP_PER_SECOND = 0.35;
/** How often Adaptive Tempo re-evaluates accuracy. */
const ADAPTIVE_EVAL_MS = 3000;

export function useTempo(player: UsePlayer) {
  const [mode, setModeState] = useState<TempoMode>('normal');
  const [customRate, setCustomRateState] = useState(1);
  const [adaptive, setAdaptive] = useState<AdaptiveTempoConfig>(DEFAULT_ADAPTIVE_CONFIG);
  const [smoothedRate, setSmoothedRate] = useState(1);
  const [action, setAction] = useState<AdaptiveAction>('maintain');
  const [message, setMessage] = useState('');

  const accuracyRef = useRef(100);
  const lastEvalRef = useRef(0);
  const targetRef = useRef(1);

  const supported = player.capabilities.playbackRate && player.hasSong;
  const provider = player.detection?.provider ?? 'direct-audio';

  const baseTarget = useMemo(
    () => (mode === 'custom' ? clampRate(customRate) : rateForMode(mode, customRate)),
    [mode, customRate],
  );

  // Adaptive evaluation — runs on a slow cadence while the song plays.
  useEffect(() => {
    if (!adaptive.enabled) {
      targetRef.current = baseTarget;
      setAction('maintain');
      setMessage('');
      return;
    }
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (now - lastEvalRef.current < ADAPTIVE_EVAL_MS) return;
      lastEvalRef.current = now;
      if (player.state.status !== 'playing') return;

      const decision = adaptiveDecision(smoothedRate, accuracyRef.current, adaptive);
      targetRef.current = decision.targetRate;
      setAction(decision.action);
      setMessage(decision.message);
    }, 400);
    return () => window.clearInterval(timer);
  }, [adaptive, baseTarget, player.state.status, smoothedRate]);

  // Base target follows mode changes unless adaptive overrode it.
  useEffect(() => {
    if (!adaptive.enabled) targetRef.current = baseTarget;
  }, [baseTarget, adaptive.enabled]);

  // Smoothing ramp — moves the applied rate toward the target gradually.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setSmoothedRate((current) => {
        const next = smoothRate(current, targetRef.current, SMOOTH_TICK_MS, MAX_STEP_PER_SECOND);
        if (Math.abs(next - current) < 0.001) return current;
        if (supported) player.setRate(next);
        return next;
      });
    }, SMOOTH_TICK_MS);
    return () => window.clearInterval(timer);
  }, [player, supported]);

  // Reset smoothing when a new song loads.
  useEffect(() => {
    if (player.state.status === 'idle' || player.state.status === 'loading') {
      targetRef.current = baseTarget;
      setSmoothedRate(baseTarget);
    }
  }, [player.state.status, baseTarget]);

  const setMode = useCallback((next: TempoMode) => {
    setModeState(next);
    if (next !== 'custom') {
      setCustomRateState(rateForMode(next, 1));
    }
  }, []);

  const setCustomRate = useCallback((rate: number) => {
    setCustomRateState(clampRate(rate));
    setModeState('custom');
  }, []);

  const setAdaptiveEnabled = useCallback((enabled: boolean) => {
    setAdaptive((prev) => ({ ...prev, enabled }));
    if (!enabled) setMessage('');
  }, []);

  const setAdaptiveRange = useCallback((minRate: number, maxRate: number) => {
    setAdaptive((prev) => ({
      ...prev,
      minRate: clampRate(minRate, 0.5, prev.maxRate),
      maxRate: clampRate(maxRate, prev.minRate, 1.5),
    }));
  }, []);

  /** Called by the typing game whenever accuracy changes meaningfully. */
  const reportAccuracy = useCallback((accuracy: number) => {
    accuracyRef.current = Number.isFinite(accuracy) ? accuracy : 100;
  }, []);

  const disabledReason = useMemo(() => {
    if (!player.hasSong) return 'Load a song to use tempo controls.';
    if (provider === 'spotify') {
      return 'Spotify embeds do not allow playback-speed changes, so tempo controls are disabled here.';
    }
    if (!player.capabilities.playbackRate) {
      return 'This provider does not allow playback-speed changes.';
    }
    if (provider === 'youtube') {
      return 'YouTube snaps custom speeds to its supported steps (0.25x–2x).';
    }
    return null;
  }, [player.hasSong, player.capabilities.playbackRate, provider]);

  return {
    mode,
    customRate,
    adaptive,
    /** What the HUD displays (smoothly moving toward the target). */
    rate: smoothedRate,
    targetRate: targetRef.current,
    supported,
    disabledReason,
    action,
    message,
    setMode,
    setCustomRate,
    setAdaptiveEnabled,
    setAdaptiveRange,
    reportAccuracy,
  };
}

export type TempoController = ReturnType<typeof useTempo>;

/**
 * Now-playing card: artwork/title, transport controls (play, seek, volume)
 * and the tempo bar (presets, custom rate, Adaptive Tempo switch).
 * Unsupported provider features are disabled with a visible explanation.
 */
import { useRef } from 'react';
import type { TempoController } from '../tempo/useTempo';
import type { UsePlayer } from '../music/usePlayer';
import { Equalizer } from '../components/Equalizer';

interface PlayerControlsProps {
  player: UsePlayer;
  tempo: TempoController;
  onOpenSong: () => void;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const TEMPO_SEGMENTS: { mode: 'slow' | 'normal' | 'fast'; label: string }[] = [
  { mode: 'slow', label: '0.75×' },
  { mode: 'normal', label: '1.0×' },
  { mode: 'fast', label: '1.25×' },
];

export function PlayerControls({ player, tempo, onOpenSong }: PlayerControlsProps) {
  const { state, capabilities } = player;
  const seekRef = useRef<HTMLInputElement>(null);

  const duration = state.duration || player.duration();
  const progressPct = duration > 0 ? (state.currentTime / duration) * 100 : 0;

  return (
    <section className="player-card card">
      <div className="now-playing">
        <div className="np-art">
          {state.meta.artwork ? <img src={state.meta.artwork} alt="" /> : <span>🎵</span>}
        </div>
        <div className="np-text">
          <div className="np-title">
            <Equalizer playing={state.status === 'playing'} />{' '}
            {state.meta.title || (player.hasSong ? 'Loaded song' : 'No song yet')}
          </div>
          <div className="np-sub">
            {state.meta.artist || (player.detection ? player.detection.provider : 'Paste a link or upload a file')}
            {state.appliedRate !== 1 ? ` · ${state.appliedRate.toFixed(2)}×` : ''}
          </div>
        </div>
        {!player.hasSong ? (
          <button type="button" className="btn btn-primary btn-sm" onClick={onOpenSong}>
            Load song
          </button>
        ) : null}
      </div>

      <div className="transport">
        <button
          type="button"
          className="play-btn"
          onClick={() => void player.toggle()}
          disabled={!player.hasSong || !capabilities.playPause || state.loading}
          aria-label={state.status === 'playing' ? 'Pause' : 'Play'}
        >
          {state.loading ? '…' : state.status === 'playing' ? '❚❚' : '▶'}
        </button>

        <div className="progress-wrap">
          <span className="time">{formatTime(state.currentTime)}</span>
          <input
            ref={seekRef}
            className="seek"
            type="range"
            min={0}
            max={Math.max(1, duration)}
            step={0.5}
            value={state.currentTime}
            disabled={!capabilities.seek || duration <= 0}
            style={{ ['--seek-pct' as string]: `${progressPct}%` }}
            onChange={(e) => player.seek(Number(e.target.value))}
            aria-label="Seek"
          />
          <span className="time">{formatTime(duration)}</span>
        </div>

        <input
          className="seek volume"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={state.volume}
          disabled={!capabilities.volume}
          style={{ ['--seek-pct' as string]: `${state.volume * 100}%` }}
          onChange={(e) => player.setVolume(Number(e.target.value))}
          aria-label="Volume"
        />
      </div>

      <div className="tempo-bar">
        <div className="seg" role="group" aria-label="Tempo presets">
          {TEMPO_SEGMENTS.map((seg) => (
            <button
              key={seg.mode}
              type="button"
              className={tempo.mode === seg.mode ? 'active' : ''}
              disabled={!tempo.supported}
              onClick={() => tempo.setMode(seg.mode)}
            >
              {seg.label}
            </button>
          ))}
          <button
            type="button"
            className={tempo.mode === 'custom' ? 'active' : ''}
            disabled={!tempo.supported}
            onClick={() => tempo.setMode('custom')}
          >
            Custom
          </button>
        </div>

        {tempo.mode === 'custom' ? (
          <label className="custom-rate">
            Rate
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.05}
              value={tempo.customRate}
              disabled={!tempo.supported}
              onChange={(e) => tempo.setCustomRate(Number(e.target.value))}
            />
            <b>{tempo.customRate.toFixed(2)}×</b>
          </label>
        ) : (
          <span className="chip">{tempo.rate.toFixed(2)}×</span>
        )}

        <label className="switch-row" title="Adaptive Tempo adjusts speed from your accuracy">
          <input
            type="checkbox"
            checked={tempo.adaptive.enabled}
            disabled={!tempo.supported}
            onChange={(e) => tempo.setAdaptiveEnabled(e.target.checked)}
          />
          Adaptive Tempo
        </label>

        {tempo.disabledReason ? <span className="tempo-hint">{tempo.disabledReason}</span> : null}
        {tempo.adaptive.enabled && tempo.message ? (
          <span className="tempo-hint">
            <span className="chip chip-live">Adaptive</span> {tempo.message}
          </span>
        ) : null}
      </div>

      {state.error ? <div className="capability-note error">{state.error}</div> : null}
      {player.detection && player.detection.limitations.length > 0 ? (
        <div className="capability-note">
          <strong>{player.detection.provider}</strong> playback notes:
          <ul>
            {player.detection.limitations.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/*
        Player surface: iframe-based providers (YouTube/Spotify) mount their
        embed here via containerRef; direct audio keeps its element detached,
        so the surface stays empty and CSS hides it (`:empty`).
      */}
      <div className="player-embed" ref={player.containerRef} aria-hidden="true" />
    </section>
  );
}

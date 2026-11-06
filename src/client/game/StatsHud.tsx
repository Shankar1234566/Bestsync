/**
 * Live stats HUD: WPM, accuracy, combo and score with a completion bar.
 * The combo tile pops whenever the streak changes.
 */
import { useEffect, useRef, useState } from 'react';
import type { LiveStats } from '../../shared';

interface StatsHudProps {
  stats: LiveStats;
  elapsedMs: number;
}

function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function StatsHud({ stats, elapsedMs }: StatsHudProps) {
  const [pop, setPop] = useState(false);
  const lastCombo = useRef(stats.bestCombo);

  useEffect(() => {
    if (stats.bestCombo !== lastCombo.current) {
      lastCombo.current = stats.bestCombo;
      setPop(true);
      const timer = window.setTimeout(() => setPop(false), 300);
      return () => window.clearTimeout(timer);
    }
  }, [stats.bestCombo]);

  return (
    <div className="hud">
      <div className="stat">
        <div className="stat-value">{stats.wpm}</div>
        <div className="stat-label">WPM</div>
        <div className="stat-sub">{stats.cpm} cpm</div>
      </div>
      <div className="stat">
        <div className="stat-value">{stats.accuracy.toFixed(1)}%</div>
        <div className="stat-label">Accuracy</div>
        <div className="stat-sub">
          {stats.correctChars}✓ / {stats.totalMistakes}✗
        </div>
      </div>
      <div className="stat">
        <div className={`stat-value warm${pop ? ' combo-pop' : ''}`}>{stats.combo}×</div>
        <div className="stat-label">Combo</div>
        <div className="stat-sub">best {stats.bestCombo}×</div>
      </div>
      <div className="stat">
        <div className="stat-value">{stats.score}</div>
        <div className="stat-label">Score</div>
        <div className="stat-sub">{formatTime(elapsedMs)}</div>
      </div>
      <div className="progress-line" title={`${stats.completion.toFixed(0)}% complete`} style={{ gridColumn: '1 / -1' }}>
        <i style={{ width: `${Math.min(100, stats.completion).toFixed(1)}%` }} />
      </div>
    </div>
  );
}

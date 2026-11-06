/**
 * Profile page: identity header with level progress, lifetime stats,
 * badges, daily/weekly challenges, recent sessions and profile editing.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, type SessionRow } from '../api/client';
import { useAuth } from '../state/AuthContext';
import { useToast } from '../state/ToastContext';
import type { BadgeDefinition, ChallengeProgressView, ProfileSummary } from '../../shared';
import { levelProgress } from '../../shared';

interface BadgeRow extends BadgeDefinition {
  unlocked: boolean;
  unlockedAt: number | null;
}

export function ProfilePage() {
  const { user, profile, loading, refreshProfile } = useAuth();
  const toast = useToast();

  const [badges, setBadges] = useState<BadgeRow[]>([]);
  const [daily, setDaily] = useState<ChallengeProgressView[]>([]);
  const [weekly, setWeekly] = useState<ChallengeProgressView[]>([]);
  const [history, setHistory] = useState<SessionRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState('');
  const [country, setCountry] = useState('');
  const [saving, setSaving] = useState(false);

  const loadAll = useCallback(async () => {
    if (!user) return;
    try {
      const [badgeResult, challengeResult, profileResult] = await Promise.all([
        api.badges(),
        api.challenges(),
        api.profile(),
      ]);
      setBadges(badgeResult.badges);
      setDaily(challengeResult.daily);
      setWeekly(challengeResult.weekly);
      setHistory(profileResult.recentPerformances);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load your profile.');
    }
  }, [user]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (profile) {
      setUsername(profile.username);
      setCountry(profile.country);
    }
  }, [profile]);

  if (loading) return <div className="skeleton" style={{ minHeight: 320 }} />;

  if (!user) {
    return (
      <div className="empty-state card">
        <h2 className="page-title">You are not signed in</h2>
        <p className="page-sub">Sign in to see your stats, badges and challenges.</p>
        <Link to="/auth" className="btn btn-primary">
          Sign in
        </Link>
      </div>
    );
  }

  const summary: ProfileSummary | null = profile;

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.updateProfile({ username: username.trim(), country: country.trim() });
      await refreshProfile();
      setEditing(false);
      toast.push('Profile updated.');
    } catch (err) {
      toast.push(err instanceof Error ? err.message : 'Could not update profile.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const tiles = summary
    ? [
        { label: 'Best WPM', value: summary.bestWpm },
        { label: 'Avg accuracy', value: `${summary.averageAccuracy.toFixed(1)}%` },
        { label: 'Highest score', value: summary.highestScore },
        { label: 'Songs completed', value: summary.totalSongsCompleted },
        { label: 'Current streak', value: `${summary.currentStreak}d` },
        { label: 'Longest streak', value: `${summary.longestStreak}d` },
        { label: 'Total chars', value: summary.totalChars },
        { label: 'Global rank', value: summary.globalRank ? `#${summary.globalRank}` : '—' },
      ]
    : [];

  const renderChallenges = (rows: ChallengeProgressView[], title: string) => (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="section-head" style={{ margin: '0 0 12px' }}>
        <h2>{title}</h2>
      </div>
      <div className="challenge-list">
        {rows.map((challenge) => (
          <div key={challenge.id} className={`challenge${challenge.completed ? ' done' : ''}`}>
            <div className="challenge-title">
              {challenge.completed ? '✅ ' : ''}
              {challenge.title}
            </div>
            <div className="challenge-desc">{challenge.description}</div>
            <div className="progress-line">
              <i
                style={{
                  width: `${Math.min(100, (challenge.progress / Math.max(1, challenge.target)) * 100).toFixed(0)}%`,
                }}
              />
            </div>
            <div className="challenge-meta">
              <span>
                {Math.min(challenge.progress, challenge.target)} / {challenge.target}
              </span>
              <span>+{challenge.xpReward} XP</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div>
      <div className="profile-head">
        <span className="avatar avatar-lg">{user.username.slice(0, 1).toUpperCase()}</span>
        <div className="profile-id">
          <h1>{summary?.username ?? user.username}</h1>
          <div className="profile-tags">
            <span className="chip">⭐ Level {summary?.level ?? user.level}</span>
            {summary?.levelName ? <span className="chip chip-ok">{summary.levelName}</span> : null}
            {summary?.country ? <span className="chip">🏳 {summary.country}</span> : null}
            <span className="chip">💜 {summary?.xp ?? user.xp} XP</span>
          </div>
          {summary ? (
            <div className="level-bar-wrap">
              <div className="level-bar-label">
                <span>Progress to next level</span>
                <span>
                  {summary.xpToNextLevel > 0 ? `${summary.xpToNextLevel} XP to go` : 'Max level reached'}
                </span>
              </div>
              <div className="level-bar">
                <i style={{ width: `${levelProgress(summary.xp).toFixed(0)}%` }} />
              </div>
            </div>
          ) : null}
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing((v) => !v)}>
          {editing ? 'Close' : 'Edit profile'}
        </button>
      </div>

      {editing ? (
        <form className="card" style={{ marginBottom: 18 }} onSubmit={saveProfile}>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="edit-username">Username</label>
              <input
                id="edit-username"
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                minLength={3}
                maxLength={24}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="edit-country">Country</label>
              <input
                id="edit-country"
                className="input"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                maxLength={56}
              />
            </div>
          </div>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </form>
      ) : null}

      {loadError ? <div className="form-error">{loadError}</div> : null}

      <div className="stat-tiles">
        {tiles.map((tile) => (
          <div key={tile.label} className="stat">
            <div className="stat-value">{tile.value}</div>
            <div className="stat-label">{tile.label}</div>
          </div>
        ))}
      </div>

      {renderChallenges(daily, '🎯 Daily challenges')}
      {renderChallenges(weekly, '🗓 Weekly challenges')}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-head" style={{ margin: '0 0 12px' }}>
          <h2>🏅 Badges</h2>
          <span className="muted small">
            {badges.filter((b) => b.unlocked).length} / {badges.length} unlocked
          </span>
        </div>
        <div className="badge-grid">
          {badges.map((badge) => (
            <div key={badge.id} className={`badge-card ${badge.unlocked ? 'unlocked' : 'locked'}`}>
              <span className="badge-icon">{badge.icon}</span>
              <div>
                <div className="badge-name">{badge.name}</div>
                <div className="badge-desc">{badge.description}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="section-head" style={{ margin: '0 0 12px' }}>
          <h2>🕒 Recent sessions</h2>
        </div>
        {history.length === 0 ? (
          <div className="empty-state">No sessions yet — your first run will show up here.</div>
        ) : (
          <div className="history-list">
            {history.map((row) => (
              <div key={row.id} className="history-row">
                <div>
                  <strong>{row.mode}</strong>
                  <div className="muted small">{new Date(row.ended_at).toLocaleString()}</div>
                </div>
                <div className="history-stats">
                  <span>{row.wpm} WPM</span>
                  <span>{row.accuracy.toFixed(1)}%</span>
                  <span>{row.score} pts</span>
                  <span>{row.completion.toFixed(0)}%</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

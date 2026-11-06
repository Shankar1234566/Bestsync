/**
 * Leaderboard page: scope tabs (global / weekly / monthly / country /
 * friends) with ranked rows. Your own row is highlighted.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../state/AuthContext';
import {
  LEADERBOARD_SCOPES,
  badgeById,
  type LeaderboardEntry,
  type LeaderboardScope,
} from '../../shared';

const SCOPE_LABELS: Record<LeaderboardScope, string> = {
  global: '🌍 Global',
  weekly: '📅 This week',
  monthly: '📅 This month',
  country: '🏳 Country',
  friends: '👥 Friends',
  song: '🎵 This song',
};

export function LeaderboardPage() {
  const { user } = useAuth();
  const [scope, setScope] = useState<LeaderboardScope>('global');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.leaderboard({
        scope,
        country: scope === 'country' ? user?.country || undefined : undefined,
        limit: 50,
      });
      setEntries(result.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the leaderboard.');
    } finally {
      setLoading(false);
    }
  }, [scope, user?.country]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleScopes = LEADERBOARD_SCOPES.filter((s) => s !== 'song' || entries.length > 0);

  return (
    <div>
      <h1 className="page-title">Leaderboard</h1>
      <p className="page-sub">The fastest fingers on the platform — ranked by best session score.</p>

      <div className="lb-controls">
        {visibleScopes.map((s) => (
          <button
            key={s}
            type="button"
            className={`btn btn-sm ${scope === s ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setScope(s)}
          >
            {SCOPE_LABELS[s]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="skeleton" style={{ minHeight: 220 }} />
      ) : error ? (
        <div className="form-error">{error}</div>
      ) : entries.length === 0 ? (
        <div className="empty-state card">
          No scores here yet. Play a song and claim the top spot!
        </div>
      ) : (
        <table className="lb-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Player</th>
              <th>Score</th>
              <th>WPM</th>
              <th>Accuracy</th>
              <th>Badges</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={`${entry.userId}-${entry.songId ?? 'top'}`} className={entry.userId === user?.id ? 'me' : ''}>
                <td className="rank-cell">
                  {entry.rank <= 3 ? (
                    <span className={`rank-medal rank-${entry.rank}`}>{entry.rank}</span>
                  ) : (
                    `#${entry.rank}`
                  )}
                </td>
                <td>
                  <div className="player-cell">
                    <span className="avatar">{entry.username.slice(0, 1).toUpperCase()}</span>
                    <span className="player-name">{entry.username}</span>
                    <span className="chip">Lv {entry.level}</span>
                  </div>
                </td>
                <td className="num">{entry.score}</td>
                <td className="num">{entry.wpm}</td>
                <td className="num">{entry.accuracy.toFixed(1)}%</td>
                <td>
                  <div className="mini-badges" title={`${entry.badges.length} badges`}>
                    {entry.badges.slice(0, 4).map((badgeId) => (
                      <span key={badgeId}>{badgeById(badgeId)?.icon ?? '🏅'}</span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

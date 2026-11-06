/**
 * Friends page: find players, send/accept friend requests and see your
 * friends' bests. Also the entry point for inviting a friend to a battle.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../state/AuthContext';
import { useToast } from '../state/ToastContext';
import type { Friend, FriendRequest, PublicUser } from '../../shared';

export function FriendsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const applyLists = useCallback(
    (data: { friends: Friend[]; incoming: FriendRequest[]; outgoing: FriendRequest[] }) => {
      setFriends(data.friends);
      setIncoming(data.incoming);
      setOutgoing(data.outgoing);
    },
    [],
  );

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      applyLists(await api.friends());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load friends.');
    } finally {
      setLoading(false);
    }
  }, [user, applyLists]);

  useEffect(() => {
    void load();
  }, [load]);

  // Debounced user search.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      setSearching(true);
      api
        .searchUsers(trimmed)
        .then((data) => setResults(data.users.filter((u) => u.id !== user?.id)))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, user?.id]);

  if (!user) {
    return (
      <div className="empty-state card">
        <h2 className="page-title">Friends</h2>
        <p className="page-sub">Sign in to add friends and challenge them to battles.</p>
        <button type="button" className="btn btn-primary" onClick={() => navigate('/auth')}>
          Sign in
        </button>
      </div>
    );
  }

  const respond = async (id: number, action: 'accept' | 'reject') => {
    try {
      applyLists(await api.respondFriendRequest(id, action));
      toast.push(action === 'accept' ? 'Friend added!' : 'Request declined.');
    } catch (err) {
      toast.push(err instanceof Error ? err.message : 'Could not respond.', 'error');
    }
  };

  const sendRequest = async (username: string) => {
    try {
      applyLists({
        friends,
        incoming,
        outgoing: [...outgoing, (await api.sendFriendRequest(username)).request],
      });
      toast.push(`Request sent to ${username}.`);
      setQuery('');
      setResults([]);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : 'Could not send request.', 'error');
    }
  };

  const removeFriend = async (userId: number) => {
    try {
      applyLists(await api.removeFriend(userId));
      toast.push('Friend removed.');
    } catch (err) {
      toast.push(err instanceof Error ? err.message : 'Could not remove friend.', 'error');
    }
  };

  return (
    <div>
      <h1 className="page-title">Friends</h1>
      <p className="page-sub">Race your friends, compare bests and keep each other streaks alive.</p>

      {error ? <div className="form-error">{error}</div> : null}

      <div className="friends-layout">
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 17, marginBottom: 10 }}>🔎 Find players</h2>
            <input
              className="input"
              placeholder="Search by username…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search players"
            />
            <div className="search-pop">
              {searching ? <span className="muted small">Searching…</span> : null}
              {results.map((player) => (
                <div key={player.id} className="friend-row">
                  <span className="avatar">{player.username.slice(0, 1).toUpperCase()}</span>
                  <div className="grow">
                    <div className="player-name">{player.username}</div>
                    <div className="friend-stats">
                      Level {player.level}
                      {player.country ? ` · ${player.country}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-soft btn-sm"
                    onClick={() => void sendRequest(player.username)}
                  >
                    Add
                  </button>
                </div>
              ))}
              {!searching && query.trim().length >= 2 && results.length === 0 ? (
                <span className="muted small">No players match that name.</span>
              ) : null}
            </div>
          </div>

          <div className="card">
            <div className="spread" style={{ marginBottom: 12 }}>
              <h2 style={{ fontSize: 17 }}>📥 Requests</h2>
              <span className="chip">{incoming.length} incoming</span>
            </div>
            {incoming.length === 0 && outgoing.length === 0 ? (
              <div className="empty-state">No pending requests.</div>
            ) : (
              <div className="friend-list">
                {incoming.map((request) => (
                  <div key={request.id} className="friend-row">
                    <span className="avatar">{request.username.slice(0, 1).toUpperCase()}</span>
                    <div className="grow">
                      <div className="player-name">{request.username}</div>
                      <div className="friend-stats">Level {request.level} wants to be friends</div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => void respond(request.id, 'accept')}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void respond(request.id, 'reject')}
                    >
                      Decline
                    </button>
                  </div>
                ))}
                {outgoing.map((request) => (
                  <div key={request.id} className="friend-row">
                    <span className="avatar">{request.username.slice(0, 1).toUpperCase()}</span>
                    <div className="grow">
                      <div className="player-name">{request.username}</div>
                      <div className="friend-stats">Request pending…</div>
                    </div>
                    <span className="chip">Pending</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="spread" style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: 17 }}>🫂 Your friends</h2>
            <span className="chip">{friends.length}</span>
          </div>
          {loading ? (
            <div className="skeleton" />
          ) : friends.length === 0 ? (
            <div className="empty-state">
              No friends yet — search for a player above and send your first request.
            </div>
          ) : (
            <div className="friend-list">
              {friends.map((friend) => (
                <div key={friend.id} className="friend-row">
                  <span className="avatar">{friend.username.slice(0, 1).toUpperCase()}</span>
                  <div className="grow">
                    <div className="player-name">{friend.username}</div>
                    <div className="friend-stats">
                      Lv {friend.level} · best {friend.bestWpm} WPM · top {friend.highestScore} pts
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void removeFriend(friend.id)}
                    aria-label={`Remove ${friend.username}`}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

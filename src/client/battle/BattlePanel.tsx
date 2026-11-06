/**
 * Multiplayer battle panel: create a battle for the loaded song, share the
 * join code, or join a friend's battle. While active it mirrors the live
 * WebSocket scores (host vs opponent) and the final standings.
 */
import { useState } from 'react';
import type { BattleDto } from '../api/client';
import type { BattleStanding } from '../battle/useBattleSocket';

interface BattlePanelProps {
  battle: BattleDto | null;
  authed: boolean;
  songUrl: string | null;
  connected: boolean;
  players: { userId: number; username: string }[];
  hostScore: number;
  opponentScore: number;
  standings: BattleStanding[] | null;
  error: string | null;
  myUserId: number | null;
  onCreate: () => Promise<void>;
  onJoin: (code: string) => Promise<void>;
  onLeave: () => void;
}

export function BattlePanel({
  battle,
  authed,
  songUrl,
  connected,
  players,
  hostScore,
  opponentScore,
  standings,
  error,
  myUserId,
  onCreate,
  onJoin,
  onLeave,
}: BattlePanelProps) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  if (!authed) {
    return (
      <section className="battle-panel">
        <h2 className="small">⚔️ Multiplayer battles</h2>
        <p className="muted small" style={{ marginTop: 8 }}>
          Sign in to battle friends in real time — create a room, share the code, and race live.
        </p>
      </section>
    );
  }

  if (!battle) {
    return (
      <section className="battle-panel">
        <div className="spread">
          <h2 style={{ fontSize: 17 }}>⚔️ Battle a friend</h2>
          <span className={`chip ${connected ? 'chip-ok' : ''}`}>
            <span className={`presence-dot${connected ? ' on' : ''}`} />
            {connected ? 'Live' : 'Offline'}
          </span>
        </div>
        {localError ? <div className="form-error" style={{ marginTop: 10 }}>{localError}</div> : null}
        {error ? <div className="form-error" style={{ marginTop: 10 }}>{error}</div> : null}

        <div className="row" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!songUrl || busy}
            onClick={async () => {
              setBusy(true);
              setLocalError(null);
              try {
                await onCreate();
              } catch (err) {
                setLocalError(err instanceof Error ? err.message : 'Could not create a battle.');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Creating…' : 'Create battle'}
          </button>
          {!songUrl ? <span className="muted small">Load a song first.</span> : null}
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <input
            className="input"
            style={{ flex: 1, textTransform: 'uppercase' }}
            placeholder="Join code"
            maxLength={8}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-label="Battle join code"
          />
          <button
            type="button"
            className="btn btn-soft"
            disabled={code.trim().length < 4 || busy}
            onClick={async () => {
              setBusy(true);
              setLocalError(null);
              try {
                await onJoin(code.trim());
                setCode('');
              } catch (err) {
                setLocalError(err instanceof Error ? err.message : 'Could not join that battle.');
              } finally {
                setBusy(false);
              }
            }}
          >
            Join
          </button>
        </div>
      </section>
    );
  }

  const iAmHost = myUserId !== null && battle.hostId === myUserId;
  const myScore = iAmHost ? hostScore : opponentScore;
  const theirScore = iAmHost ? opponentScore : hostScore;

  if (battle.status === 'waiting') {
    return (
      <section className="battle-panel">
        <h2 style={{ fontSize: 17 }}>Waiting for an opponent…</h2>
        <p className="muted small" style={{ margin: '10px 0 4px' }}>
          Share this code with a friend — the battle starts the moment they join.
        </p>
        <div className="battle-code">{battle.joinCode}</div>
        <div className="row" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              void navigator.clipboard?.writeText(battle.joinCode);
            }}
          >
            Copy code
          </button>
          <button type="button" className="btn btn-danger-soft btn-sm" onClick={onLeave}>
            Cancel battle
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="battle-panel">
      <div className="spread">
        <h2 style={{ fontSize: 17 }}>⚔️ Battle live</h2>
        <span className={`chip ${connected ? 'chip-ok' : 'chip-warn'}`}>
          <span className={`presence-dot${connected ? ' on' : ''}`} />
          {connected ? `${players.length} connected` : 'Reconnecting…'}
        </span>
      </div>

      <div className="battle-scores">
        <div className={`battle-side${myScore > theirScore ? ' leading' : ''}`}>
          <div className="small muted">{iAmHost ? 'You' : 'Opponent'}</div>
          <div className="battle-score">{myScore}</div>
        </div>
        <div className="battle-vs">VS</div>
        <div className={`battle-side${theirScore > myScore ? ' leading' : ''}`}>
          <div className="small muted">{iAmHost ? 'Opponent' : 'You'}</div>
          <div className="battle-score">{theirScore}</div>
        </div>
      </div>

      {standings ? (
        <div className="challenge-list">
          {standings.map((row) => (
            <div key={row.userId} className={`challenge${row.isWinner ? ' done' : ''}`}>
              <div className="challenge-title">
                {row.isWinner ? '🏆 ' : ''}
                {row.username} — {row.score} pts
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted small">Type along with the song — your score streams to your rival live.</p>
      )}

      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onLeave}>
          {standings ? 'New battle' : 'Forfeit'}
        </button>
      </div>
    </section>
  );
}

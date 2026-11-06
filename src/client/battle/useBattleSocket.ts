/**
 * WebSocket client for realtime battles.
 * Protocol mirrors src/server/ws/battles.ts:
 *   send: { type: 'score' | 'finish', battleId, score, ... }
 *   recv: joined / presence / scores / finished / error
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getToken } from '../api/client';

export interface BattlePlayer {
  userId: number;
  username: string;
}

export interface BattleStanding {
  userId: number;
  username: string;
  score: number;
  isWinner: boolean;
}

interface BattleSocketState {
  connected: boolean;
  players: BattlePlayer[];
  hostScore: number;
  opponentScore: number;
  standings: BattleStanding[] | null;
  error: string | null;
}

const INITIAL: BattleSocketState = {
  connected: false,
  players: [],
  hostScore: 0,
  opponentScore: 0,
  standings: null,
  error: null,
};

export function useBattleSocket(battleId: number | null) {
  const [state, setState] = useState<BattleSocketState>(INITIAL);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (battleId === null) {
      setState(INITIAL);
      return;
    }
    const token = getToken();
    if (!token) {
      setState({ ...INITIAL, error: 'Sign in to join a battle.' });
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(
      `${protocol}://${window.location.host}/ws?token=${encodeURIComponent(token)}&battleId=${battleId}`,
    );
    socketRef.current = socket;

    socket.onopen = () => setState((prev) => ({ ...prev, connected: true, error: null }));
    socket.onclose = () => setState((prev) => ({ ...prev, connected: false }));
    socket.onerror = () => setState((prev) => ({ ...prev, error: 'Battle connection failed.' }));
    socket.onmessage = (event) => {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      switch (payload.type) {
        case 'joined':
          setState((prev) => ({
            ...prev,
            players: (payload.players as BattlePlayer[]) ?? prev.players,
          }));
          break;
        case 'scores':
          setState((prev) => ({
            ...prev,
            hostScore: Number(payload.hostScore) || 0,
            opponentScore: Number(payload.opponentScore) || 0,
          }));
          break;
        case 'finished':
          setState((prev) => ({ ...prev, standings: (payload.standings as BattleStanding[]) ?? [] }));
          break;
        case 'error':
          setState((prev) => ({ ...prev, error: String(payload.message ?? 'Battle error.') }));
          break;
        default:
          break;
      }
    };

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [battleId]);

  const send = useCallback((message: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }, []);

  const sendScore = useCallback(
    (score: number, wpm: number, accuracy: number, progress: number) => {
      if (battleId === null) return;
      send({ type: 'score', battleId, score, wpm, accuracy, progress });
    },
    [battleId, send],
  );

  const sendFinish = useCallback(
    (score: number) => {
      if (battleId === null) return;
      send({ type: 'finish', battleId, score });
    },
    [battleId, send],
  );

  return { ...state, sendScore, sendFinish };
}

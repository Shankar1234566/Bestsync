/**
 * Realtime battle transport over WebSockets.
 *
 * Protocol (JSON):
 *   client -> server: { type: 'score', battleId, score, wpm, accuracy, progress }
 *   client -> server: { type: 'finish', battleId, score }
 *   server -> client: { type: 'joined', battleId, players }
 *   server -> client: { type: 'presence', userId, username, connected }
 *   server -> client: { type: 'scores', hostScore, opponentScore }
 *   server -> client: { type: 'finished', standings }
 *   server -> client: { type: 'error', message }
 *
 * Authentication happens during the HTTP upgrade via ?token=<JWT>.
 * Score values are persisted through BattleService and are never trusted for
 * XP/leaderboards — final XP still requires a validated REST submission.
 */
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import type { AppContext } from '../context';
import { verifyToken } from '../middleware/auth';

interface ClientState {
  socket: WebSocket;
  userId: number;
  username: string;
  battleId: number;
}

interface ScoreMessage {
  type: 'score';
  battleId: number;
  score: number;
  wpm?: number;
  accuracy?: number;
  progress?: number;
}

interface FinishMessage {
  type: 'finish';
  battleId: number;
  score: number;
}

type IncomingMessageUnion = ScoreMessage | FinishMessage;

const MAX_SCORE_MESSAGE_BYTES = 4096;
/** Minimum ms between persisted score updates per client. */
const SCORE_PERSIST_INTERVAL = 900;

export class BattleSocketServer {
  private readonly wss: WebSocketServer;
  private readonly rooms = new Map<number, Set<ClientState>>();
  private readonly lastScoreAt = new Map<ClientState, number>();

  constructor(
    server: HttpServer,
    private readonly ctx: AppContext,
  ) {
    this.wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head));
  }

  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== '/ws') {
      // This API server only upgrades battle sockets — reject anything else
      // so clients never hang on an unhandled upgrade.
      socket.destroy();
      return;
    }

    const token = url.searchParams.get('token') ?? '';
    const battleId = Number(url.searchParams.get('battleId'));
    const userId = token ? verifyToken(token, this.ctx.config) : null;

    if (userId === null || !Number.isInteger(battleId) || battleId <= 0) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const battle = this.ctx.battles.byId(battleId);
    const isParticipant =
      battle !== undefined &&
      (battle.host_id === userId || battle.opponent_id === userId);
    if (!isParticipant) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const user = this.ctx.auth.byId(userId);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      const client: ClientState = { socket: ws, userId, username: user.username, battleId };
      this.register(client);
    });
  }

  private register(client: ClientState): void {
    let room = this.rooms.get(client.battleId);
    if (!room) {
      room = new Set();
      this.rooms.set(client.battleId, room);
    }
    room.add(client);

    const players = this.roomPlayers(client.battleId);
    this.send(client, { type: 'joined', battleId: client.battleId, players });
    this.broadcast(client.battleId, {
      type: 'presence',
      userId: client.userId,
      username: client.username,
      connected: true,
    });
    this.broadcastScores(client.battleId);

    client.socket.on('message', (raw) => this.onMessage(client, raw));
    client.socket.on('close', () => this.onClose(client));
    client.socket.on('error', () => this.onClose(client));
  }

  private onMessage(client: ClientState, raw: Buffer | ArrayBuffer | Buffer[]): void {
    if (raw.toString().length > MAX_SCORE_MESSAGE_BYTES) return;
    let parsed: IncomingMessageUnion;
    try {
      parsed = JSON.parse(raw.toString()) as IncomingMessageUnion;
    } catch {
      this.send(client, { type: 'error', message: 'Malformed message.' });
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || parsed.battleId !== client.battleId) {
      return;
    }

    if (parsed.type === 'score') {
      const score = Math.max(0, Math.round(Number(parsed.score) || 0));
      const now = Date.now();
      const last = this.lastScoreAt.get(client) ?? 0;
      if (now - last >= SCORE_PERSIST_INTERVAL) {
        this.lastScoreAt.set(client, now);
        try {
          this.ctx.battles.recordScore(client.battleId, client.userId, score);
          this.broadcastScores(client.battleId);
        } catch {
          this.send(client, { type: 'error', message: 'Could not record score.' });
        }
      }
      return;
    }

    if (parsed.type === 'finish') {
      try {
        const score = Math.max(0, Math.round(Number(parsed.score) || 0));
        this.ctx.battles.recordScore(client.battleId, client.userId, score);
        this.broadcastScores(client.battleId);
        const standings = this.ctx.battles.standings(this.ctx.battles.finish(client.battleId).id);
        this.broadcast(client.battleId, { type: 'finished', standings });
      } catch {
        this.send(client, { type: 'error', message: 'Could not finish the battle.' });
      }
    }
  }

  private onClose(client: ClientState): void {
    const room = this.rooms.get(client.battleId);
    if (room) {
      room.delete(client);
      if (room.size === 0) this.rooms.delete(client.battleId);
    }
    this.lastScoreAt.delete(client);
    const stillConnected = [...(this.rooms.get(client.battleId) ?? [])].some(
      (c) => c.userId === client.userId,
    );
    if (!stillConnected) {
      this.broadcast(client.battleId, {
        type: 'presence',
        userId: client.userId,
        username: client.username,
        connected: false,
      });
    }
    try {
      client.socket.close();
    } catch {
      // Socket already gone.
    }
  }

  private roomPlayers(battleId: number): { userId: number; username: string }[] {
    const seen = new Map<number, string>();
    for (const client of this.rooms.get(battleId) ?? []) {
      seen.set(client.userId, client.username);
    }
    return [...seen].map(([userId, username]) => ({ userId, username }));
  }

  private broadcastScores(battleId: number): void {
    const battle = this.ctx.battles.byId(battleId);
    if (!battle) return;
    this.broadcast(battleId, {
      type: 'scores',
      hostScore: battle.host_score,
      opponentScore: battle.opponent_score,
    });
  }

  private broadcast(battleId: number, payload: unknown): void {
    const room = this.rooms.get(battleId);
    if (!room) return;
    const text = JSON.stringify(payload);
    for (const client of room) {
      if (client.socket.readyState === WebSocket.OPEN) client.socket.send(text);
    }
  }

  private send(client: ClientState, payload: unknown): void {
    if (client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(JSON.stringify(payload));
    }
  }

  async close(): Promise<void> {
    for (const room of this.rooms.values()) {
      for (const client of room) {
        try {
          client.socket.close(1001, 'Server shutting down');
        } catch {
          // Ignore.
        }
      }
    }
    this.rooms.clear();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }
}

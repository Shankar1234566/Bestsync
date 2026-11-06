/**
 * Game page — wires the music engine, tempo controller, typing game,
 * lyrics, teddy mascot and multiplayer battles into one screen.
 *
 * Data flow: song URL (query param or staged upload) → player adapter →
 * playback clock drives lyric highlighting in playback-driven modes.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, type BattleDto } from '../api/client';
import { pendingFile } from '../music/pendingFile';
import { usePlayer } from '../music/usePlayer';
import { useTempo } from '../tempo/useTempo';
import { useTypingGame } from '../game/useTypingGame';
import { PlayerControls } from '../player/PlayerControls';
import { StatsHud } from '../game/StatsHud';
import { TypingArea } from '../game/TypingArea';
import { ResultsScreen } from '../game/ResultsScreen';
import { LyricsPanel } from '../lyrics/LyricsPanel';
import { LyricsEditor } from '../lyrics/LyricsEditor';
import { Teddy, type TeddyState } from '../teddy/Teddy';
import { BattlePanel } from '../battle/BattlePanel';
import { useBattleSocket } from '../battle/useBattleSocket';
import { useAuth } from '../state/AuthContext';
import { useToast } from '../state/ToastContext';
import { GAME_MODE_LABELS, type GameMode, type SessionResult } from '../../shared';

export function GamePage() {
  const [searchParams] = useSearchParams();
  const urlParam = searchParams.get('url');
  const modeParam = searchParams.get('mode');
  const mode: GameMode = (
    ['practice', 'beat', 'challenge', 'free', 'battle'] as GameMode[]
  ).includes(modeParam as GameMode)
    ? (modeParam as GameMode)
    : 'practice';

  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();

  const player = usePlayer();
  const tempo = useTempo(player);

  /* ------------------------------- battles ----------------------------- */

  const [battle, setBattle] = useState<BattleDto | null>(null);
  const battleRef = useRef<BattleDto | null>(null);
  battleRef.current = battle;
  const socket = useBattleSocket(battle?.id ?? null);

  const effectiveMode: GameMode =
    battle && battle.status === 'active' ? 'battle' : mode === 'battle' ? 'practice' : mode;

  /* ------------------------------- lyrics ------------------------------ */

  const [songUrl, setSongUrl] = useState<string | null>(null);
  const [lyricsText, setLyricsText] = useState('');
  /** Where the current lyrics came from — drives the panel status chip. */
  const [lyricsOrigin, setLyricsOrigin] = useState<'saved' | 'discovered' | 'manual' | null>(null);
  /** Automatic lookup lifecycle: searching → ready | missing. */
  const [lyricsStatus, setLyricsStatus] = useState<'idle' | 'searching' | 'ready' | 'missing'>('idle');
  const [lyricsHint, setLyricsHint] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorNonce, setEditorNonce] = useState(0);
  const [loaderOpen, setLoaderOpen] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [result, setResult] = useState<SessionResult | null>(null);

  const game = useTypingGame({
    mode: effectiveMode,
    player,
    songUrl,
    songTitle: player.state.meta.title || null,
    tempoRate: tempo.rate,
    adaptiveTempo: tempo.adaptive.enabled,
    onComplete: (res) => {
      setResult(res);
      if (battleRef.current?.status === 'active') socket.sendFinish(res.score);
    },
    onAccuracy: tempo.reportAccuracy,
  });

  /* ---------------------------- song loading --------------------------- */

  /**
   * Read the media duration, waiting briefly for providers (YouTube) that
   * only report it shortly after the player is ready. Capped so providers
   * without duration support (Spotify embeds) never stall the lyrics fetch.
   */
  async function pollDuration(read: () => number, maxMs = 1500): Promise<number> {
    const deadline = Date.now() + maxMs;
    for (;;) {
      const duration = read();
      if (duration > 0 || Date.now() >= deadline) return duration;
      await new Promise((resolve) => window.setTimeout(resolve, 150));
    }
  }

  /** URL whose lyrics are loaded (or currently being fetched). */
  const lyricsForUrlRef = useRef<string | null>(null);

  const loadSong = useCallback(
    async (rawUrl: string) => {
      const res = await player.load(rawUrl);
      if (res.error) {
        toast.push(res.error, 'error');
        return false;
      }
      setSongUrl(rawUrl);
      setLoaderOpen(false);

      // A different song — drop the previous lyrics immediately so the
      // old words can never be typed against the new music. Keyed on the
      // lyrics ref rather than this render's `songUrl` (which a concurrent
      // duplicate call still sees as the previous song): the ref is only
      // ever cleared here for a genuinely different URL, so a second pass
      // for the same URL can never wipe lyrics it is about to reuse.
      if (lyricsForUrlRef.current !== rawUrl) {
        setLyricsText('');
        setLyricsOrigin(null);
        setLyricsHint(null);
        if (game.doc.lines.length > 0) game.setLyrics('');
      }

      // Already fetched (or in flight) for this exact URL — StrictMode's
      // double effect and battle rejoins both land here. The ref is set
      // synchronously before any await, so both passes cannot both fetch.
      if (lyricsForUrlRef.current === rawUrl) return true;
      lyricsForUrlRef.current = rawUrl;

      // Automatic lyrics: saved → discovered → friendly empty. Public, so
      // the paste-and-play flow never requires signing in.
      setLyricsStatus('searching');
      try {
        const duration = await pollDuration(() => player.duration());
        const data = await api.getLyrics(rawUrl, duration > 0 ? duration : null);
        if (lyricsForUrlRef.current !== rawUrl) return true; // superseded
        if (data.lyrics) {
          setLyricsText(data.lyrics.content);
          game.setLyrics(data.lyrics.content);
          setLyricsOrigin(data.source ?? 'discovered');
          setLyricsStatus('ready');
          setLyricsHint(null);
          if (data.source === 'discovered') {
            toast.push(
              data.lyrics.timed
                ? 'Lyrics found and synced automatically ✨'
                : 'Lyrics found automatically — plain text, so lines follow your typing.',
            );
          }
        } else {
          setLyricsStatus('missing');
          setLyricsHint(data.hint ?? null);
          toast.push(
            data.hint ?? 'No lyrics found for this song — you can add your own as a fallback.',
            'error',
          );
        }
      } catch {
        if (lyricsForUrlRef.current !== rawUrl) return true;
        setLyricsStatus('missing');
        setLyricsHint('Lyrics lookup failed — you can add lyrics manually.');
      }
      return true;
    },
    [player, game, toast],
  );

  // Boot: pick up a staged upload or the URL from the query string.
  // Keyed only on the query param — the loader lives in a ref, so a re-render
  // never restarts playback. React StrictMode runs effects twice in dev
  // (mount → cleanup → mount) and the cleanup aborts the first pass's
  // in-flight load, so a staged file is remembered here and the second pass
  // loads it again instead of silently ending up with no song.
  const bootLoadRef = useRef(loadSong);
  bootLoadRef.current = loadSong;
  const stagedFileRef = useRef<File | null>(null);

  useEffect(() => {
    const staged = pendingFile.get() ?? stagedFileRef.current;
    if (staged) {
      stagedFileRef.current = staged;
      pendingFile.set(null);
      void player.loadFile(staged).then((res) => {
        if (res.error) toast.push(res.error, 'error');
      });
      return;
    }
    if (urlParam) void bootLoadRef.current(urlParam);
    // Intentionally keyed on urlParam only: loadSong/toast change identity
    // across renders and would otherwise restart the song on every render.
  }, [urlParam]);

  const onLoaderSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (urlInput.trim()) void loadSong(urlInput.trim());
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    void player.loadFile(file).then((res) => {
      if (res.error) toast.push(res.error, 'error');
      else {
        setSongUrl(null);
        setLoaderOpen(false);
      }
    });
  };

  const saveLyrics = useCallback(
    async (text: string) => {
      game.setLyrics(text);
      setLyricsText(text);
      setLyricsOrigin('manual');
      setLyricsStatus(text.trim() ? 'ready' : 'missing');
      if (!songUrl) return;
      if (!user) {
        toast.push('Lyrics kept for this session — sign in to save them to your account.');
        return;
      }
      try {
        await api.saveLyrics(songUrl, text);
        setLyricsOrigin('saved');
        toast.push('Lyrics saved.');
      } catch {
        toast.push('Lyrics saved locally — could not sync to the server.', 'error');
      }
    },
    [game.setLyrics, songUrl, toast, user],
  );

  /* --------------------------- battle lifecycle ------------------------ */

  // While waiting for an opponent, poll so the host notices the join.
  useEffect(() => {
    if (!battle || battle.status !== 'waiting') return;
    const timer = window.setInterval(() => {
      api
        .activeBattle()
        .then((data) => {
          if (data.battle && data.battle.status === 'active') {
            setBattle(data.battle);
            toast.push('Battle started — type like the wind! ⚔️');
          } else if (!data.battle) {
            setBattle(null);
          }
        })
        .catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [battle, toast]);

  // Load the battle's song when joining someone else's room.
  const battleLoadAttemptRef = useRef<string | null>(null);
  useEffect(() => {
    if (!battle || battle.status === 'finished' || battle.status === 'cancelled') return;
    if (battleLoadAttemptRef.current === battle.songUrl) return;
    battleLoadAttemptRef.current = battle.songUrl;
    if (songUrl === battle.songUrl) return;
    void loadSong(battle.songUrl);
  }, [battle, songUrl, loadSong]);

  // Refresh active battle on mount (e.g. rejoin after refresh).
  const battleBootRef = useRef(false);
  useEffect(() => {
    if (battleBootRef.current || !user) return;
    battleBootRef.current = true;
    api
      .activeBattle()
      .then((data) => {
        if (data.battle) setBattle(data.battle);
      })
      .catch(() => undefined);
  }, [user]);

  const createBattle = useCallback(async () => {
    if (!songUrl) throw new Error('Load a song first.');
    const data = await api.createBattle(songUrl, 'battle');
    setBattle(data.battle);
    toast.push(`Battle created — share code ${data.battle.joinCode}`);
  }, [songUrl, toast]);

  const joinBattle = useCallback(
    async (code: string) => {
      const data = await api.joinBattle(code);
      setBattle(data.battle);
      battleLoadAttemptRef.current = data.battle.songUrl;
      toast.push('Joined the battle!');
    },
    [toast],
  );

  const leaveBattle = useCallback(async () => {
    const current = battleRef.current;
    setBattle(null);
    battleLoadAttemptRef.current = null;
    if (!current) return;
    try {
      await api.forfeitBattle(current.id);
      toast.push(current.status === 'waiting' ? 'Battle cancelled.' : 'Battle forfeited.');
    } catch {
      // Already finished server-side — nothing to do.
    }
  }, [toast]);

  // Battle standings toast.
  useEffect(() => {
    if (!socket.standings) return;
    const winner = socket.standings.find((row) => row.isWinner);
    toast.push(winner ? `Battle over — ${winner.username} wins! 🏆` : 'Battle over — it was a draw!');
  }, [socket.standings, toast]);

  // Stream live scores to the opponent while a battle runs.
  const liveStatsRef = useRef(game.stats);
  liveStatsRef.current = game.stats;
  useEffect(() => {
    if (!socket.connected || battle?.status !== 'active') return;
    const timer = window.setInterval(() => {
      const s = liveStatsRef.current;
      socket.sendScore(s.score, s.wpm, s.accuracy, s.completion);
    }, 1200);
    return () => window.clearInterval(timer);
  }, [socket, socket.connected, battle?.status]);

  /* -------------------------------- teddy ------------------------------ */

  const [transientMood, setTransientMood] = useState<TeddyState | null>(null);
  const feedback = game.feedback;
  const feedbackSeq = feedback?.seq;
  const feedbackOk = feedback?.ok;
  const combo = game.stats.combo;
  useEffect(() => {
    if (!feedbackSeq) return;
    setTransientMood(!feedbackOk ? 'confused' : combo >= 20 ? 'excited' : 'happy');
    const timer = window.setTimeout(() => setTransientMood(null), 950);
    return () => window.clearTimeout(timer);
  }, [feedbackSeq, feedbackOk, combo]);

  const baseMood: TeddyState =
    game.phase === 'finished'
      ? 'victory'
      : game.phase === 'paused'
        ? 'relaxed'
        : game.phase === 'playing' || player.state.status === 'playing'
          ? 'dancing'
          : 'idle';
  const mood = transientMood ?? baseMood;

  /* ------------------------------- controls ---------------------------- */

  const focusInput = () => window.setTimeout(() => game.inputRef.current?.focus(), 0);

  const startRun = () => {
    if (lyricsStatus === 'searching') {
      toast.push('Still fetching lyrics for this song — one moment…');
      return;
    }
    if (!game.activeText) {
      toast.push(
        lyricsStatus === 'missing' && lyricsHint
          ? `${lyricsHint} Click “Add lyrics” to type your own.`
          : 'Add lyrics first — click “Add lyrics” on the right.',
        'error',
      );
      setEditorNonce((n) => n + 1);
      setEditorOpen(true);
      return;
    }
    void player.play();
    focusInput();
  };

  const playAgain = () => {
    setResult(null);
    game.reset();
    player.seek(0);
    focusInput();
  };

  const hasLyrics = game.doc.lines.length > 0;
  const canSeek = player.capabilities.seek;

  return (
    <div>
      <div className="spread" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: 2 }}>
            {GAME_MODE_LABELS[effectiveMode]}
          </h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>
            {player.hasSong
              ? player.state.meta.title || 'Playing your song'
              : 'Load a song to begin'}
          </p>
        </div>
        <div className="row-wrap">
          <span className={`chip ${game.phase === 'playing' ? 'chip-live' : ''}`}>
            {game.phase === 'idle' ? 'Ready' : game.phase}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLoaderOpen((v) => !v)}>
            {player.hasSong ? 'Change song' : 'Load song'}
          </button>
        </div>
      </div>

      {loaderOpen || !player.hasSong ? (
        <form className="card" style={{ marginBottom: 16 }} onSubmit={onLoaderSubmit}>
          <div className="loader-row" style={{ marginTop: 0 }}>
            <input
              className="input"
              placeholder="Paste a YouTube / Spotify / direct audio link"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              aria-label="Song link"
            />
            <button type="submit" className="btn btn-primary">
              Load
            </button>
            <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
              Upload audio
              <input
                type="file"
                accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.opus"
                hidden
                onChange={(e) => onFile(e.target.files?.[0])}
              />
            </label>
          </div>
        </form>
      ) : null}

      <div className="game-layout">
        <div className="game-col">
          <PlayerControls player={player} tempo={tempo} onOpenSong={() => setLoaderOpen(true)} />

          <div className="row-wrap">
            {game.phase === 'idle' ? (
              <button type="button" className="btn btn-primary btn-lg" onClick={startRun}>
                ▶ Start run
              </button>
            ) : null}
            {game.phase === 'playing' || game.phase === 'paused' ? (
              <>
                <button type="button" className="btn btn-soft btn-lg" onClick={game.togglePause}>
                  {game.phase === 'playing' ? '⏸ Pause' : '▶ Resume'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => game.finish('manual')}>
                  End run
                </button>
              </>
            ) : null}
            {game.isPlaybackDriven ? (
              <span className="chip chip-warn" title="Playback position drives the active line">
                🎧 beat-synced
              </span>
            ) : (
              <span className="chip">✍️ typing-driven</span>
            )}
          </div>

          <StatsHud stats={game.stats} elapsedMs={game.elapsedMs} />

          <TypingArea
            activeText={game.activeText}
            nextText={game.nextText}
            typed={game.typed}
            inputRef={game.inputRef}
            onKeyDown={game.onInputKeyDown}
            onBeforeInput={game.onInputBeforeInput}
            onPaste={game.onInputPaste}
            feedback={game.feedback}
            waitingForBeat={game.waitingForBeat}
            disabled={game.phase === 'finished' || !hasLyrics}
          />
        </div>

        <div className="game-col">
          <LyricsPanel
            doc={game.doc}
            lineIndex={game.lineIndex}
            onSeekLine={canSeek ? (ms) => player.seek(ms / 1000) : undefined}
            onEdit={() => {
              setEditorNonce((n) => n + 1);
              setEditorOpen(true);
            }}
            editable
            emptyText={
              lyricsStatus === 'searching'
                ? '🔎 Looking up lyrics for this song…'
                : lyricsStatus === 'missing'
                  ? (lyricsHint ??
                    'No matching lyrics found — you can add your own as a fallback.')
                  : undefined
            }
            statusLabel={
              lyricsStatus === 'searching'
                ? '🔎 Finding lyrics…'
                : lyricsStatus === 'missing'
                  ? '⚠️ No lyrics found'
                  : lyricsOrigin === 'discovered'
                    ? game.doc.timed
                      ? '✨ Auto · synced'
                      : '✨ Auto · plain'
                    : lyricsOrigin === 'saved'
                      ? game.doc.timed
                        ? '⏱ LRC synced · saved'
                        : 'Plain lyrics · saved'
                      : game.doc.timed
                        ? '⏱ LRC synced'
                        : 'Plain lyrics'
            }
          />

          <section className="teddy-card card">
            <Teddy state={mood} tempo={player.state.appliedRate} />
            <div className="teddy-mood">
              {mood === 'victory' && result
                ? `${result.score} points — Teddy is proud!`
                : mood === 'confused'
                  ? 'Teddy spotted a typo…'
                  : mood === 'excited'
                    ? `${combo}× combo — Teddy is pumped!`
                    : undefined}
            </div>
          </section>

          <BattlePanel
            battle={battle}
            authed={Boolean(user)}
            songUrl={songUrl}
            connected={socket.connected}
            players={socket.players}
            hostScore={socket.hostScore}
            opponentScore={socket.opponentScore}
            standings={socket.standings}
            error={socket.error}
            myUserId={user?.id ?? null}
            onCreate={createBattle}
            onJoin={joinBattle}
            onLeave={() => void leaveBattle()}
          />
        </div>
      </div>

      <LyricsEditor
        key={editorNonce}
        open={editorOpen}
        initial={lyricsText}
        onSave={saveLyrics}
        onClose={() => setEditorOpen(false)}
      />

      {result && game.phase === 'finished' ? (
        <ResultsScreen
          result={result}
          authed={Boolean(user)}
          onPlayAgain={playAgain}
          onExit={() => navigate('/')}
        />
      ) : null}
    </div>
  );
}

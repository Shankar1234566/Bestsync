/**
 * Home page — the entry point: paste a song link (or upload audio), pick a
 * game mode, and start typing. Also shows recently played and favourite
 * songs for signed-in players.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type SongDto } from '../api/client';
import { pendingFile } from '../music/pendingFile';
import { useAuth } from '../state/AuthContext';
import { parsePlayerUrl, GAME_MODE_LABELS, type GameMode } from '../../shared';

const MODES: { mode: GameMode; blurb: string }[] = [
  { mode: 'practice', blurb: 'Type at your own pace — the highlight follows you.' },
  { mode: 'beat', blurb: "Playback drives the line — miss it and it's passed." },
  { mode: 'challenge', blurb: 'Beat mode with a 1.5× score multiplier.' },
  { mode: 'free', blurb: 'Sequential typing, no pressure — just you and the words.' },
];

const PROVIDER_STRIP = [
  { icon: '▶️', label: 'YouTube', note: 'embed playback · tempo snaps to YT steps' },
  { icon: '🟢', label: 'Spotify', note: 'embed playback · no tempo/seek controls' },
  { icon: '🎧', label: 'Direct audio', note: 'MP3/WAV/OGG upload — full control' },
];

export function HomePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<GameMode>('practice');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [recent, setRecent] = useState<(SongDto & { played_at: number })[]>([]);
  const [favourites, setFavourites] = useState<SongDto[]>([]);

  useEffect(() => {
    if (!user) return;
    api.recentSongs().then((r) => setRecent(r.songs)).catch(() => undefined);
    api.favouriteSongs().then((r) => setFavourites(r.songs)).catch(() => undefined);
  }, [user]);

  const start = useCallback(
    (rawUrl: string) => {
      const detection = parsePlayerUrl(rawUrl);
      if (!detection.valid || !detection.normalizedUrl) {
        setUrlError(detection.reason ?? 'That link does not look like a supported song.');
        return;
      }
      setUrlError(null);
      navigate(`/game?url=${encodeURIComponent(detection.normalizedUrl)}&mode=${mode}`);
    },
    [mode, navigate],
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    start(url.trim());
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    pendingFile.set(file);
    navigate(`/game?mode=${mode}`);
  };

  const openSong = (song: SongDto) => {
    setUrl(song.url);
    start(song.url);
  };

  return (
    <div>
      <section className="hero">
        <span className="chip chip-live">🎵 Music-powered typing</span>
        <h1>
          Type to the beat with <span className="brand-grad">BeatSync</span>
        </h1>
        <p>
          Paste a YouTube, Spotify or direct-audio link, type the lyrics in sync with the music, and
          earn XP, badges and leaderboard ranks — with Teddy dancing along.
        </p>

        <form className="loader-row" onSubmit={submit}>
          <input
            className="input"
            placeholder="Paste a song link — youtube.com/watch?v=… or open.spotify.com/track/…"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (urlError) setUrlError(null);
            }}
            aria-label="Song link"
          />
          <button type="submit" className="btn btn-primary btn-lg">
            Start typing
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-lg"
            onClick={() => fileRef.current?.click()}
          >
            Upload audio
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.opus"
            hidden
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </form>

        {urlError ? <div className="capability-note error">{urlError}</div> : null}

        <div className="provider-strip">
          {PROVIDER_STRIP.map((provider) => (
            <span key={provider.label} className="chip" title={provider.note}>
              {provider.icon} {provider.label}
            </span>
          ))}
        </div>
        <div className="capability-note">
          We never download or scrape audio from YouTube or Spotify — playback happens inside their
          official embeds. Uploaded files stay in your browser. Unsupported features (like Spotify
          tempo) are disabled with an explanation.
        </div>
      </section>

      <div className="section-head">
        <h2>Choose your mode</h2>
      </div>
      <div className="mode-picker">
        {MODES.map((option) => (
          <button
            key={option.mode}
            type="button"
            className={`mode-option${mode === option.mode ? ' selected' : ''}`}
            onClick={() => setMode(option.mode)}
            aria-pressed={mode === option.mode}
          >
            <strong>{GAME_MODE_LABELS[option.mode]}</strong>
            <span>{option.blurb}</span>
          </button>
        ))}
      </div>

      {recent.length > 0 ? (
        <>
          <div className="section-head">
            <h2>Recently played</h2>
          </div>
          <div className="song-grid">
            {recent.slice(0, 8).map((song) => (
              <article key={song.id} className="song-card card-hover" onClick={() => openSong(song)}>
                <div className="song-art">{song.artwork_url ? <img src={song.artwork_url} alt="" /> : '🎵'}</div>
                <div className="song-meta">
                  <div className="song-title">{song.title}</div>
                  <div className="song-sub">{song.artist || song.provider}</div>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : null}

      {favourites.length > 0 ? (
        <>
          <div className="section-head">
            <h2>❤️ Favourites</h2>
          </div>
          <div className="song-grid">
            {favourites.map((song) => (
              <article key={song.id} className="song-card card-hover" onClick={() => openSong(song)}>
                <div className="song-art">{song.artwork_url ? <img src={song.artwork_url} alt="" /> : '🎵'}</div>
                <div className="song-meta">
                  <div className="song-title">{song.title}</div>
                  <div className="song-sub">{song.artist || song.provider}</div>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : null}

      <div className="section-head">
        <h2>How it works</h2>
      </div>
      <div className="grid-3">
        <div className="card card-hover">
          <div style={{ fontSize: 26 }}>🔗</div>
          <h3 style={{ margin: '8px 0 6px', fontSize: 16 }}>1. Load a song</h3>
          <p className="muted small">Paste a link or upload a track, then add lyrics (plain or LRC).</p>
        </div>
        <div className="card card-hover">
          <div style={{ fontSize: 26 }}>⌨️</div>
          <h3 style={{ margin: '8px 0 6px', fontSize: 16 }}>2. Type to the beat</h3>
          <p className="muted small">
            Live WPM, accuracy and combos — Adaptive Tempo tunes the speed to your skill.
          </p>
        </div>
        <div className="card card-hover">
          <div style={{ fontSize: 26 }}>🏆</div>
          <h3 style={{ margin: '8px 0 6px', fontSize: 16 }}>3. Level up</h3>
          <p className="muted small">Every run earns XP, unlocks badges and moves you up the ranks.</p>
        </div>
      </div>
    </div>
  );
}

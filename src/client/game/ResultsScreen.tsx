/**
 * Results screen — shown when a session finishes. Submits the score to the
 * API (server re-validates plausibility) and reveals XP, level-ups, badges
 * and challenge completions returned by the server.
 */
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { ScoreAck, SessionResult } from '../../shared';
import { GAME_MODE_LABELS } from '../../shared';

interface ResultsScreenProps {
  result: SessionResult;
  authed: boolean;
  onPlayAgain: () => void;
  onExit: () => void;
}

type SubmitState =
  | { phase: 'idle' }
  | { phase: 'submitting' }
  | { phase: 'done'; ack: ScoreAck }
  | { phase: 'failed'; reason: string }
  | { phase: 'anon' };

export function ResultsScreen({ result, authed, onPlayAgain, onExit }: ResultsScreenProps) {
  const [submit, setSubmit] = useState<SubmitState>({ phase: 'idle' });
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (!authed) {
      setSubmit({ phase: 'anon' });
      return;
    }
    setSubmit({ phase: 'submitting' });
    api
      .submitScore({
        songUrl: result.songUrl,
        mode: result.mode,
        wpm: result.wpm,
        cpm: result.cpm,
        accuracy: result.accuracy,
        correctChars: result.correctChars,
        incorrectChars: result.incorrectChars,
        totalMistakes: result.totalMistakes,
        keystrokes: result.keystrokes,
        bestCombo: result.bestCombo,
        score: result.score,
        completion: result.completion,
        elapsedMs: result.elapsedMs,
        linesCompleted: result.linesCompleted,
        linesMissed: result.linesMissed,
        totalLines: result.totalLines,
        tempoRate: result.tempoRate,
        adaptiveTempo: result.adaptiveTempo,
      })
      .then((ack) => setSubmit({ phase: 'done', ack }))
      .catch((error: unknown) => {
        const reason =
          error instanceof ApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'Could not save your score.';
        setSubmit({ phase: 'failed', reason });
      });
  }, [authed, result]);

  const cells = [
    { label: 'WPM', value: String(result.wpm) },
    { label: 'Accuracy', value: `${result.accuracy.toFixed(1)}%` },
    { label: 'Best combo', value: `${result.bestCombo}×` },
    { label: 'Score', value: String(result.score) },
    { label: 'Lines', value: `${result.linesCompleted}/${result.totalLines}` },
    { label: 'Time', value: `${Math.round(result.elapsedMs / 1000)}s` },
  ];

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-label="Session results">
        <h2>🎵 {GAME_MODE_LABELS[result.mode]}</h2>
        <p className="muted small">
          {result.songTitle ?? 'Untitled session'}
          {result.tempoRate !== 1 ? ` · ${result.tempoRate.toFixed(2)}× tempo` : ''}
        </p>

        <div className="results-grid">
          {cells.map((cell) => (
            <div key={cell.label} className="result-cell">
              <b>{cell.value}</b>
              <span>{cell.label}</span>
            </div>
          ))}
        </div>

        {submit.phase === 'submitting' ? (
          <div className="row" style={{ marginBottom: 14 }}>
            <span className="spinner" />
            <span className="muted small">Saving your score…</span>
          </div>
        ) : null}

        {submit.phase === 'done' ? (
          <>
            <div className="xp-reveal">
              <span>
                +{submit.ack.xpGained} XP · Level {submit.ack.level} — {submit.ack.levelName}
              </span>
              <b>+{submit.ack.xpGained}</b>
            </div>
            {submit.ack.leveledUp ? (
              <div className="leveled-up">⬆ Level up! You reached level {submit.ack.level}.</div>
            ) : null}
            {submit.ack.unlockedBadges.length > 0 ? (
              <div className="badge-unlocks">
                {submit.ack.unlockedBadges.map((badge) => (
                  <div key={badge.id} className="badge-unlock">
                    <span aria-hidden="true">{badge.icon}</span> {badge.name} unlocked!
                  </div>
                ))}
              </div>
            ) : null}
            {submit.ack.challengesCompleted.length > 0 ? (
              <div className="badge-unlocks">
                {submit.ack.challengesCompleted.map((challenge) => (
                  <div key={challenge.id} className="badge-unlock">
                    <span aria-hidden="true">🎯</span> {challenge.title} complete (+{challenge.xpReward} XP)
                  </div>
                ))}
              </div>
            ) : null}
            {submit.ack.rank !== null ? (
              <p className="muted small" style={{ marginBottom: 14 }}>
                Global rank #{submit.ack.rank}
              </p>
            ) : null}
          </>
        ) : null}

        {submit.phase === 'anon' ? (
          <div className="capability-note" style={{ marginBottom: 14 }}>
            Playing as a guest — sign in to save this score, earn XP and climb the leaderboard.
          </div>
        ) : null}

        {submit.phase === 'failed' ? (
          <div className="form-error">Score not saved: {submit.reason}</div>
        ) : null}

        <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" className="btn btn-ghost" onClick={onExit}>
            Back to home
          </button>
          <button type="button" className="btn btn-primary" onClick={onPlayAgain}>
            Play again
          </button>
        </div>
      </div>
    </div>
  );
}

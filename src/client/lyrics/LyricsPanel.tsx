/**
 * Lyrics panel: scrollable lyric lines with the active line highlighted.
 * Clicking a timed line seeks playback there (playback-driven modes only).
 * The toolbar opens the lyrics editor when no lyrics are loaded yet.
 */
import { useEffect, useRef } from 'react';
import type { LyricDocument } from '../../shared';

interface LyricsPanelProps {
  doc: LyricDocument;
  lineIndex: number;
  /** Seek to a line's timestamp (null when the line is untimed). */
  onSeekLine?: (timeMs: number) => void;
  onEdit: () => void;
  editable: boolean;
  statusLabel: string;
  /** Override for the empty-state copy (e.g. why auto-discovery found nothing). */
  emptyText?: string;
}

function formatStamp(timeMs: number): string {
  const total = Math.floor(timeMs / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function LyricsPanel({
  doc,
  lineIndex,
  onSeekLine,
  onEdit,
  editable,
  statusLabel,
  emptyText,
}: LyricsPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  // Keep the active line centered while the song plays.
  useEffect(() => {
    const container = scrollRef.current;
    const line = activeRef.current;
    if (!container || !line) return;
    const target = line.offsetTop - container.clientHeight / 2 + line.clientHeight / 2;
    container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }, [lineIndex]);

  return (
    <section className="lyrics-card card">
      <div className="lyrics-toolbar">
        <strong className="small">Lyrics</strong>
        <div className="row">
          <span className="chip">{statusLabel}</span>
          {editable ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
              {doc.lines.length > 0 ? 'Edit' : 'Add lyrics'}
            </button>
          ) : null}
        </div>
      </div>

      {doc.lines.length === 0 ? (
        <div className="lyrics-empty">
          {emptyText ??
            'No lyrics loaded yet. Paste or type your lyrics to start typing along with the song.'}
        </div>
      ) : (
        <div className="lyrics-scroll" ref={scrollRef}>
          {doc.lines.map((line, i) => {
            const state = i < lineIndex ? 'past' : i === lineIndex ? 'active' : '';
            return (
              <div
                key={line.index}
                ref={i === lineIndex ? activeRef : undefined}
                className={`lyric-line ${state}`}
                onClick={() => {
                  if (doc.timed && onSeekLine && i <= lineIndex) onSeekLine(line.timeMs);
                }}
                role={doc.timed ? 'button' : undefined}
                tabIndex={doc.timed ? 0 : undefined}
                onKeyDown={(e) => {
                  if (doc.timed && onSeekLine && (e.key === 'Enter' || e.key === ' ') && i <= lineIndex) {
                    e.preventDefault();
                    onSeekLine(line.timeMs);
                  }
                }}
              >
                {doc.timed ? <span className="stamp">{formatStamp(line.timeMs)}</span> : null}
                {line.text}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

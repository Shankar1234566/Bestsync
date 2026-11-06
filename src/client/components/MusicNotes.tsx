/**
 * Ambient floating music notes behind page content.
 * Purely decorative — `aria-hidden`, pointer-events none.
 */
const NOTES = ['♪', '♫', '♬', '♩', '♭'];

interface MusicNotesProps {
  /** How many notes to float (kept small — CSS does the heavy lifting). */
  count?: number;
}

export function MusicNotes({ count = 9 }: MusicNotesProps) {
  const spans = Array.from({ length: count }, (_, i) => (
    <span
      key={i}
      style={{
        left: `${(i * 100) / count + 4}%`,
        animationDelay: `${(i * 1.6) % 14}s`,
        animationDuration: `${12 + (i % 4) * 2.5}s`,
        fontSize: `${16 + ((i * 7) % 14)}px`,
      }}
    >
      {NOTES[i % NOTES.length]}
    </span>
  ));
  return (
    <div className="music-notes" aria-hidden="true">
      {spans}
    </div>
  );
}

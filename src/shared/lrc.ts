/**
 * Lyrics parsing: timestamped LRC and plain (untimed) lyrics.
 *
 * Copyright note: BeatSync never fetches or scrapes lyrics. Lyrics only ever
 * come from what the user pastes or from an authorized provider integration.
 */
import type { LyricDocument, LyricLine } from './types';

const TIMESTAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const METADATA = /^\[(ti|ar|al|by|re|ve|offset):(.*)\]\s*$/i;

function toMs(min: string, sec: string, frac: string | undefined): number {
  const minutes = Number(min);
  const seconds = Number(sec);
  let ms = 0;
  if (frac !== undefined) {
    // .x = tenths, .xx = hundredths, .xxx = milliseconds
    const fracText = frac.padEnd(3, '0').slice(0, 3);
    ms = Number(fracText);
  }
  return minutes * 60_000 + seconds * 1000 + ms;
}

/**
 * Parse LRC text (with optional metadata tags and multi-timestamp lines)
 * into a time-sorted lyric document.
 */
export function parseLrc(text: string): LyricDocument {
  const metadata: Record<string, string> = {};
  const stamped: LyricLine[] = [];
  let offsetMs = 0;

  const rawLines = text.split(/\r?\n/);
  for (const raw of rawLines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;

    const meta = line.match(METADATA);
    if (meta) {
      metadata[meta[1].toLowerCase()] = meta[2].trim();
      if (meta[1].toLowerCase() === 'offset') {
        const value = Number(meta[2]);
        if (Number.isFinite(value)) offsetMs = value;
      }
      continue;
    }

    TIMESTAMP.lastIndex = 0;
    const times: number[] = [];
    let match: RegExpExecArray | null;
    let lastIndex = 0;
    while ((match = TIMESTAMP.exec(line)) !== null) {
      times.push(toMs(match[1], match[2], match[3]));
      lastIndex = TIMESTAMP.lastIndex;
    }

    if (times.length === 0) continue;
    const content = line.slice(lastIndex).trim();
    if (!content) continue;
    for (const timeMs of times) {
      stamped.push({ timeMs, text: content, index: 0 });
    }
  }

  if (stamped.length === 0) {
    return { lines: [], timed: false, metadata, ...(offsetMs ? {} : {}) };
  }

  stamped.sort((a, b) => a.timeMs - b.timeMs);
  const lines = stamped.map((line, i) => ({
    ...line,
    timeMs: Math.max(0, line.timeMs + offsetMs),
    index: i + 1,
  }));

  return { lines, timed: true, metadata };
}

/** Parse plain lyrics (no timestamps) into sequential untimed lines. */
export function parsePlainLyrics(text: string): LyricDocument {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l, i) => ({ timeMs: 0, text: l, index: i + 1 }));
  return { lines, timed: false, metadata: {} };
}

/**
 * Auto-detect format: LRC when at least 30% of content lines carry a
 * timestamp and at least one exists, otherwise plain lyrics.
 */
export function parseLyricsInput(text: string): LyricDocument {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return { lines: [], timed: false, metadata: {} };

  const lines = trimmed.split(/\r?\n/);
  const contentLines = lines.filter((l) => l.trim().length > 0 && !METADATA.test(l.trim()));
  const timedCount = contentLines.filter((l) => {
    TIMESTAMP.lastIndex = 0;
    return TIMESTAMP.test(l);
  }).length;

  const looksTimed = timedCount > 0 && timedCount / Math.max(contentLines.length, 1) >= 0.3;
  return looksTimed ? parseLrc(trimmed) : parsePlainLyrics(trimmed);
}

/**
 * Index of the active lyric line for a playback position, or null when the
 * document is untimed (progression is then driven by typing, not time).
 * Uses binary search — safe to call every animation frame.
 */
export function activeLineIndex(doc: LyricDocument, timeMs: number): number | null {
  if (!doc.timed || doc.lines.length === 0) return null;
  const lines = doc.lines;
  // Last line whose start time <= timeMs.
  let lo = 0;
  let hi = lines.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].timeMs <= timeMs) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result === -1 ? -1 : result;
}

/** Serialise a document back to LRC text (manual timestamp editing round-trip). */
export function toLrc(doc: LyricDocument): string {
  const meta = Object.entries(doc.metadata)
    .map(([k, v]) => `[${k}:${v}]`)
    .join('\n');
  const body = doc.lines
    .map((line) => {
      const total = Math.max(0, line.timeMs);
      const minutes = Math.floor(total / 60000);
      const seconds = Math.floor((total % 60000) / 1000);
      const centis = Math.floor((total % 1000) / 10);
      const stamp = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(
        centis,
      ).padStart(2, '0')}`;
      return `[${stamp}]${line.text}`;
    })
    .join('\n');
  return meta ? `${meta}\n${body}` : body;
}

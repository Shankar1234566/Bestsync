import { describe, expect, it } from 'vitest';
import {
  activeLineIndex,
  parseLyricsInput,
  parseLrc,
  parsePlainLyrics,
  toLrc,
} from '../src/shared';

describe('parseLrc', () => {
  it('parses timestamps, metadata and sorts lines chronologically', () => {
    const doc = parseLrc(
      ['[ti:Test Song]', '[ar:Some Artist]', '[00:15.00]Second', '[00:12.50]First'].join('\n'),
    );
    expect(doc.timed).toBe(true);
    // Metadata keeps raw LRC tags as keys (ti, ar, al, …).
    expect(doc.metadata.ti).toBe('Test Song');
    expect(doc.metadata.ar).toBe('Some Artist');
    expect(doc.lines.map((l) => l.text)).toEqual(['First', 'Second']);
    expect(doc.lines[0].timeMs).toBe(12_500);
    expect(doc.lines[1].timeMs).toBe(15_000);
    expect(doc.lines[0].index).toBe(1);
    expect(doc.lines[1].index).toBe(2);
  });

  it('supports fractional precision (.x, .xx, .xxx)', () => {
    const doc = parseLrc(['[00:01.5]tenths', '[00:02.25]hundredths', '[00:03.123]ms'].join('\n'));
    expect(doc.lines.map((l) => l.timeMs)).toEqual([1_500, 2_250, 3_123]);
  });

  it('expands multi-timestamp lines into one entry per stamp', () => {
    const doc = parseLrc('[00:10.00][00:30.00]Chorus line');
    expect(doc.lines).toHaveLength(2);
    expect(doc.lines.every((l) => l.text === 'Chorus line')).toBe(true);
    expect(doc.lines.map((l) => l.timeMs)).toEqual([10_000, 30_000]);
  });

  it('applies the [offset:] tag to every timestamp', () => {
    const doc = parseLrc(['[offset:+500]', '[00:01.00]Shifted'].join('\n'));
    expect(doc.lines[0].timeMs).toBe(1_500);
  });

  it('returns an empty untimed doc when nothing is timestamped', () => {
    const doc = parseLrc('just some plain text\nmore text');
    expect(doc.lines).toHaveLength(0);
    expect(doc.timed).toBe(false);
  });
});

describe('parsePlainLyrics', () => {
  it('keeps non-empty lines in order with 1-based indexes', () => {
    const doc = parsePlainLyrics('  First  \n\nSecond\n\n  Third ');
    expect(doc.timed).toBe(false);
    expect(doc.lines.map((l) => l.text)).toEqual(['First', 'Second', 'Third']);
    expect(doc.lines.map((l) => l.index)).toEqual([1, 2, 3]);
    expect(doc.lines.every((l) => l.timeMs === 0)).toBe(true);
  });
});

describe('parseLyricsInput auto-detection', () => {
  it('treats empty input as an empty untimed doc', () => {
    const doc = parseLyricsInput('   ');
    expect(doc.lines).toHaveLength(0);
    expect(doc.timed).toBe(false);
  });

  it('detects LRC when >= 30% of content lines are stamped', () => {
    const doc = parseLyricsInput(
      ['[00:01.00]One', '[00:02.00]Two', '[00:03.00]Three'].join('\n'),
    );
    expect(doc.timed).toBe(true);
    expect(doc.lines).toHaveLength(3);
  });

  it('keeps only the stamped lines when a mostly-timed file has strays', () => {
    const doc = parseLyricsInput(['[00:01.00]One', 'Two', 'Three'].join('\n'));
    expect(doc.timed).toBe(true);
    expect(doc.lines.map((l) => l.text)).toEqual(['One']);
  });

  it('falls back to plain lyrics when only a few lines are stamped', () => {
    const doc = parseLyricsInput(
      ['[00:01.00]One', 'Two', 'Three', 'Four', 'Five'].join('\n'),
    );
    expect(doc.timed).toBe(false);
    expect(doc.lines).toHaveLength(5);
  });
});

describe('activeLineIndex', () => {
  const doc = parseLrc(['[00:01.00]A', '[00:05.00]B', '[00:09.00]C'].join('\n'));

  it('returns -1 before the first line starts', () => {
    expect(activeLineIndex(doc, 0)).toBe(-1);
    expect(activeLineIndex(doc, 999)).toBe(-1);
  });

  it('returns the last line whose start is <= time', () => {
    expect(activeLineIndex(doc, 1_000)).toBe(0);
    expect(activeLineIndex(doc, 4_999)).toBe(0);
    expect(activeLineIndex(doc, 5_000)).toBe(1);
    expect(activeLineIndex(doc, 8_999)).toBe(1);
    expect(activeLineIndex(doc, 60_000)).toBe(2);
  });

  it('returns null for untimed or empty documents', () => {
    expect(activeLineIndex(parsePlainLyrics('a\nb'), 1_000)).toBeNull();
    expect(activeLineIndex({ lines: [], timed: true, metadata: {} }, 1_000)).toBeNull();
  });
});

describe('toLrc round-trip', () => {
  it('serialises back into parseable LRC', () => {
    const original = parseLrc(['[ti:Round Trip]', '[00:12.50]Hello world', '[00:16.00]Goodbye'].join('\n'));
    const text = toLrc(original);
    const again = parseLrc(text);
    expect(again.lines.map((l) => [l.timeMs, l.text])).toEqual(
      original.lines.map((l) => [l.timeMs, l.text]),
    );
    expect(again.metadata.ti).toBe('Round Trip');
  });

  it('zero-pads minutes, seconds and centiseconds', () => {
    const text = toLrc(parseLrc('[00:05.25]Hi'));
    expect(text).toBe('[00:05.25]Hi');
  });
});

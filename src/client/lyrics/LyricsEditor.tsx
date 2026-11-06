/**
 * Modal lyrics editor — paste plain text or LRC and save.
 * Saving persists the lyrics server-side (per song URL) and reloads the doc.
 */
import { useState } from 'react';

interface LyricsEditorProps {
  open: boolean;
  initial: string;
  onSave: (text: string) => Promise<void>;
  onClose: () => void;
}

export function LyricsEditor({ open, initial, onSave, onClose }: LyricsEditorProps) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const save = async () => {
    if (!text.trim()) {
      setError('Lyrics cannot be empty.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(text);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save lyrics.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Lyrics editor"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Add lyrics</h2>
        <p className="muted small" style={{ marginBottom: 12 }}>
          Paste plain lyrics or an LRC file with timestamps ([mm:ss.xx]) for beat-synced play.
        </p>
        {error ? <div className="form-error">{error}</div> : null}
        <textarea
          className="textarea"
          style={{ minHeight: 220 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'[00:12.50] First line\n[00:16.00] Second line'}
          autoFocus
        />
        <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save lyrics'}
          </button>
        </div>
      </div>
    </div>
  );
}

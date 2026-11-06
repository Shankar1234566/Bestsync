/**
 * The typing surface: renders the active lyric character-by-character with
 * live ok/bad/caret styling, a preview of the next line, and a hidden input
 * that captures keystrokes (keydown for desktop, beforeinput for mobile).
 */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

interface TypingAreaProps {
  activeText: string;
  nextText: string | null;
  typed: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onBeforeInput: (event: FormEvent<HTMLInputElement>) => void;
  onPaste: (event: React.ClipboardEvent<HTMLInputElement>) => void;
  /** Bumped on every accepted keystroke — drives the flash feedback. */
  feedback: { seq: number; ok: boolean } | null;
  waitingForBeat: boolean;
  disabled: boolean;
}

export function TypingArea({
  activeText,
  nextText,
  typed,
  inputRef,
  onKeyDown,
  onBeforeInput,
  onPaste,
  feedback,
  waitingForBeat,
  disabled,
}: TypingAreaProps) {
  const [focused, setFocused] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // Keep the hidden input focused while the game is live so keystrokes land.
  useEffect(() => {
    if (!disabled && cardRef.current && document.activeElement?.tagName !== 'INPUT') {
      inputRef.current?.focus();
    }
  }, [disabled, inputRef, activeText]);

  const [flashOk, setFlashOk] = useState(true);
  useEffect(() => {
    if (!feedback) return;
    setFlashOk(feedback.ok);
    const timer = window.setTimeout(() => setFlashOk(true), 160);
    return () => window.clearTimeout(timer);
  }, [feedback?.seq, feedback?.ok]);

  const chars = Array.from(activeText);

  return (
    <div
      ref={cardRef}
      className={`typing-card card${focused ? ' focused' : ''}`}
      onClick={() => inputRef.current?.focus()}
    >
      <div className="typing-target" aria-label="Lyric line to type">
        {chars.length === 0 ? (
          <span className="muted">Type the lyrics as they appear…</span>
        ) : (
          chars.map((char, i) => {
            const cls =
              i < typed.length
                ? typed[i] === char
                  ? 'char ok'
                  : 'char bad'
                : i === typed.length
                  ? 'char cursor-char'
                  : 'char';
            return (
              <span key={`${i}-${char}`} className={cls}>
                {char === ' ' ? ' ' : char}
              </span>
            );
          })
        )}
      </div>

      {nextText ? <div className="typing-next">next › {nextText}</div> : null}

      {waitingForBeat ? (
        <div className="typing-hint">
          <span className="chip chip-live">Line complete — waiting for the beat…</span>
        </div>
      ) : null}

      <div className="typing-hint">
        <span aria-hidden="true">⌨️</span>
        <span>
          Click here and type — mistakes are highlighted in red. Backspace fixes them.
          {flashOk === false ? ' Keep going!' : ''}
        </span>
      </div>

      <input
        ref={inputRef}
        className="typing-input"
        type="text"
        inputMode="text"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label="Typing input"
        disabled={disabled}
        onKeyDown={onKeyDown}
        onBeforeInput={onBeforeInput}
        onPaste={onPaste}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
    </div>
  );
}

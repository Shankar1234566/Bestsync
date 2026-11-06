/**
 * BeatSync mascot — an SVG teddy bear with seven animated moods.
 * The Game page derives the mood from live gameplay (playback, accuracy,
 * combo, completion) and this component only renders it.
 */
export type TeddyState =
  | 'idle'
  | 'dancing'
  | 'happy'
  | 'confused'
  | 'excited'
  | 'victory'
  | 'relaxed';

export const TEDDY_MOODS: Record<TeddyState, { label: string; bubble: string }> = {
  idle: { label: 'Waiting for the beat…', bubble: 'Ready when you are!' },
  dancing: { label: 'Dancing to the music', bubble: '♪ Let’s groove ♪' },
  happy: { label: 'Loving those keystrokes', bubble: 'Nice one!' },
  confused: { label: 'Spotted a typo', bubble: 'Oops — keep going!' },
  excited: { label: 'On a combo streak', bubble: 'Combo time! 🔥' },
  victory: { label: 'Song complete!', bubble: 'You did it! 🎉' },
  relaxed: { label: 'Taking a breather', bubble: 'I’ll wait… zZz' },
};

interface TeddyProps {
  state: TeddyState;
  /** Short line shown in the speech bubble (defaults per state). */
  bubble?: string | null;
  size?: number;
  /**
   * Playback tempo (0.5–1.5×). Drives `--teddy-beat` so the dance speeds
   * up with a fast song and slows down with a slow one.
   */
  tempo?: number;
}

/** Base groove length at 1.0× — every tempo-reactive state scales off it. */
const BEAT_BASE_MS = 720;

export function Teddy({ state, bubble, size = 116, tempo = 1 }: TeddyProps) {
  const mood = TEDDY_MOODS[state];
  const text = bubble === undefined ? mood.bubble : bubble;
  const clampedTempo = Math.min(1.5, Math.max(0.5, tempo));
  const beatMs = Math.round(BEAT_BASE_MS / clampedTempo);

  return (
    <div className="teddy-stage" style={{ ['--teddy-beat' as string]: `${beatMs}ms` }}>
      {text ? <div className="teddy-bubble">{text}</div> : null}
      <svg
        className={`teddy teddy--${state}`}
        width={size}
        height={size}
        viewBox="0 0 200 200"
        role="img"
        aria-label={`Teddy bear mascot: ${mood.label}`}
      >
        <defs>
          <radialGradient id="teddyFur" cx="45%" cy="35%" r="75%">
            <stop offset="0%" stopColor="#fde9d3" />
            <stop offset="60%" stopColor="#f7c99b" />
            <stop offset="100%" stopColor="#e8a86b" />
          </radialGradient>
          <radialGradient id="teddyBelly" cx="50%" cy="40%" r="70%">
            <stop offset="0%" stopColor="#fff7ec" />
            <stop offset="100%" stopColor="#ffe3c2" />
          </radialGradient>
          <linearGradient id="teddyNote" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#f472b6" />
          </linearGradient>
        </defs>

        {/* shadow */}
        <ellipse cx="100" cy="184" rx="52" ry="9" fill="rgba(42,31,77,0.14)" />

        <g className="body-g">
          {/* ears */}
          <circle cx="55" cy="52" r="22" fill="url(#teddyFur)" stroke="#d9955a" strokeWidth="2" />
          <circle cx="145" cy="52" r="22" fill="url(#teddyFur)" stroke="#d9955a" strokeWidth="2" />
          <circle cx="55" cy="52" r="11" fill="#f9b7a2" />
          <circle cx="145" cy="52" r="11" fill="#f9b7a2" />

          {/* head */}
          <circle cx="100" cy="88" r="48" fill="url(#teddyFur)" stroke="#d9955a" strokeWidth="2" />

          {/* muzzle */}
          <ellipse cx="100" cy="106" rx="26" ry="19" fill="url(#teddyBelly)" />

          {/* eyes (blink animated via CSS) */}
          <g className="eye">
            <ellipse cx="82" cy="82" rx="7" ry="8" fill="#3b2b57" />
            <ellipse cx="118" cy="82" rx="7" ry="8" fill="#3b2b57" />
            <circle cx="84.5" cy="79.5" r="2.4" fill="#fff" />
            <circle cx="120.5" cy="79.5" r="2.4" fill="#fff" />
          </g>

          {/* nose + smile */}
          <ellipse cx="100" cy="99" rx="7.5" ry="5.5" fill="#3b2b57" />
          <path
            d="M100 104.5 q0 8 -10 10 M100 104.5 q0 8 10 10"
            fill="none"
            stroke="#3b2b57"
            strokeWidth="2.6"
            strokeLinecap="round"
          />

          {/* blush */}
          <ellipse cx="64" cy="100" rx="8" ry="5" fill="#f9a8b8" opacity="0.75" />
          <ellipse cx="136" cy="100" rx="8" ry="5" fill="#f9a8b8" opacity="0.75" />

          {/* body */}
          <path
            d="M60 150 q40 -26 80 0 q10 26 -8 34 q-32 12 -64 0 q-18 -8 -8 -34z"
            fill="url(#teddyFur)"
            stroke="#d9955a"
            strokeWidth="2"
          />
          <ellipse cx="100" cy="164" rx="24" ry="17" fill="url(#teddyBelly)" />

          {/* arms */}
          <ellipse cx="54" cy="146" rx="13" ry="21" fill="url(#teddyFur)" stroke="#d9955a" strokeWidth="2" transform="rotate(24 54 146)" />
          <ellipse cx="146" cy="146" rx="13" ry="21" fill="url(#teddyFur)" stroke="#d9955a" strokeWidth="2" transform="rotate(-24 146 146)" />

          {/* feet */}
          <ellipse cx="74" cy="184" rx="16" ry="10" fill="url(#teddyFur)" stroke="#d9955a" strokeWidth="2" />
          <ellipse cx="126" cy="184" rx="16" ry="10" fill="url(#teddyFur)" stroke="#d9955a" strokeWidth="2" />

          {/* little music note friend */}
          <g transform="translate(150 96) rotate(12)">
            <path
              d="M0 0 v16 q0 5 -6 6 a5 5 0 1 0 4 6 v-11 l12 -3 v10 q0 5 -6 6 a5 5 0 1 0 4 6 z"
              fill="url(#teddyNote)"
            />
          </g>
        </g>
      </svg>
    </div>
  );
}

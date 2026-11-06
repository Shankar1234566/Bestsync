/** Animated five-bar equalizer used next to the now-playing title. */
export function Equalizer({ playing = true }: { playing?: boolean }) {
  return (
    <span className={`equalizer${playing ? '' : ' paused'}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

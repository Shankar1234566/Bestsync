/**
 * Module-scope handoff for a locally uploaded audio file.
 * Files never leave the browser — we can't put a File in the URL, so the
 * Home page stages it here and the Game page picks it up on mount.
 */
let staged: File | null = null;

export const pendingFile = {
  get(): File | null {
    return staged;
  },
  set(file: File | null): void {
    staged = file;
  },
};

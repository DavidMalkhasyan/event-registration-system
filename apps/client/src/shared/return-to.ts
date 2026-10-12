// Where to return after confirming a re-authentication link (FR-ORG-5, ADR-010 §8).
// A per-browser convenience only: storage can be unavailable, and then the organizer lands on
// the events list. Only organizer paths are accepted, so the value can never redirect elsewhere.

const KEY = 'ers.reauth.returnTo';
const ORGANIZER_PATH = /^\/organizer(\/[A-Za-z0-9_-]+)*$/;

export function saveReturnTo(path: string): void {
  if (!ORGANIZER_PATH.test(path)) return;
  try {
    localStorage.setItem(KEY, path);
  } catch {
    // Storage unavailable (private mode, blocked site data): fall back to the events list.
  }
}

/** Returns the saved organizer path once, then forgets it. */
export function takeReturnTo(): string | null {
  try {
    const path = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
    return path && ORGANIZER_PATH.test(path) ? path : null;
  } catch {
    return null;
  }
}

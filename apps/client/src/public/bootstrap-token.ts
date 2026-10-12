// FR-LNK-10 (b), ADR-011, PD-71: the only static import of the public entry (boot.ts); it has no imports.
// It reads the link token from the URL fragment, keeps it only in memory, and removes the
// fragment from the address bar and the current history entry before any other module runs.

let token: string | null = null;

export function captureFragmentToken(location: Location, history: History): string | null {
  const match = /^#t=([A-Za-z0-9_-]{43})$/.exec(location.hash);
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  return match ? match[1]! : null;
}

token = captureFragmentToken(window.location, window.history);

/** The link token for this page view, or null (reloading loses it by design, FR-LNK-10 e). */
export function linkToken(): string | null {
  return token;
}

/**
 * After a management rotation the page switches to the new token, in memory only (FR-ROT-5,
 * FR-LNK-10): never the address bar, cookies or browser storage.
 */
export function replaceLinkToken(next: string): void {
  token = next;
}

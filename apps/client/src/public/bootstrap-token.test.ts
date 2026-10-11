import { describe, expect, it } from 'vitest';
import { captureFragmentToken } from './bootstrap-token';

const TOKEN = 'A'.repeat(43);

describe('fragment token bootstrap (FR-LNK-10 b, AC-173)', () => {
  it('keeps the token in memory and removes the fragment from the address bar and history entry', () => {
    window.history.replaceState(null, '', `/manage#t=${TOKEN}`);
    const token = captureFragmentToken(window.location, window.history);
    expect(token).toBe(TOKEN);
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/manage');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('treats a malformed fragment as no token and still removes it', () => {
    window.history.replaceState(null, '', '/verify#t=short');
    expect(captureFragmentToken(window.location, window.history)).toBeNull();
    expect(window.location.hash).toBe('');
  });

  it('returns null after a reload without the fragment (lost by design, FR-LNK-10 e)', () => {
    window.history.replaceState(null, '', '/verify');
    expect(captureFragmentToken(window.location, window.history)).toBeNull();
  });
});

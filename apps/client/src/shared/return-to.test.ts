import { beforeEach, describe, expect, it } from 'vitest';
import { saveReturnTo, takeReturnTo } from './return-to';

describe('return path after re-authentication', () => {
  beforeEach(() => localStorage.clear());

  it('returns a saved organizer path exactly once', () => {
    saveReturnTo('/organizer/events/0d6c5c9e-1c1f-4c55-9a51-6b1f2d3e4f5a');
    expect(takeReturnTo()).toBe('/organizer/events/0d6c5c9e-1c1f-4c55-9a51-6b1f2d3e4f5a');
    expect(takeReturnTo()).toBeNull();
  });

  it('never stores or returns anything outside the organizer area (no open redirect)', () => {
    for (const path of [
      '//evil.example',
      'https://evil.example/organizer',
      '/organizer/../e/x',
      '/e/abc',
      '/organizerx',
      '/organizer/a?b=c',
    ])
      saveReturnTo(path);
    expect(takeReturnTo()).toBeNull();
    localStorage.setItem('ers.reauth.returnTo', '//evil.example'); // even if written by something else
    expect(takeReturnTo()).toBeNull();
  });
});

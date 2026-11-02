import { describe, it, expect, afterEach, vi } from 'vitest';
import { secureCookies } from './cookie-security';

describe('secureCookies', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is secure when the app is served over https', () => {
    vi.stubEnv('APP_URL', 'https://innstant.in');
    expect(secureCookies()).toBe(true);
  });

  it('is not when a production build is served over http, as in CI', () => {
    vi.stubEnv('APP_URL', 'http://localhost:3000');
    vi.stubEnv('NODE_ENV', 'production');
    expect(secureCookies()).toBe(false);
  });

  it('falls back to the build when no address is set', () => {
    vi.stubEnv('APP_URL', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(secureCookies()).toBe(true);
  });
});

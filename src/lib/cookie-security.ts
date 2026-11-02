/**
 * Whether a cookie this app sets should be `Secure`.
 *
 * From the address the app is served at, not from NODE_ENV. Production is
 * https (`APP_URL=https://innstant.in`) and gets Secure cookies as before.
 * A production BUILD served over plain http — the e2e suite in CI, on
 * http://localhost — must not: Chromium quietly accepts a Secure cookie on
 * http://localhost, WebKit drops it, and every iPhone test then ran without a
 * session and saw an empty page. With no APP_URL, a production build is
 * assumed to be behind https.
 */
export function secureCookies(): boolean {
  const url = process.env.APP_URL;
  if (url) return url.startsWith('https://');
  return process.env.NODE_ENV === 'production';
}

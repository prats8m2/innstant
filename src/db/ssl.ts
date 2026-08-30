/**
 * How to open the TLS connection, decided from the connection string.
 *
 * Every client in the repo used to hardcode `ssl: { rejectUnauthorized: false }`
 * because Railway requires TLS and its proxy certificate is not in the system
 * CA store. That is correct against Railway and impossible against a Postgres
 * service container in CI, which speaks no TLS at all and closes the connection
 * on the SSLRequest — so the integration suite could only ever run against the
 * shared remote database (S8, D-024).
 *
 * The rule: a local host, or an explicit `sslmode=disable`, means no TLS.
 * Anything else is remote and gets TLS with certificate verification off.
 *
 * `rejectUnauthorized: false` is deliberate and is NOT "TLS off": the transport
 * is still encrypted, we simply do not verify the proxy's certificate chain,
 * which Railway's generated certificates would fail. Revisit when the database
 * is reached over a private network rather than the public proxy — at that
 * point pin the CA instead.
 */
export type DbSsl = false | { rejectUnauthorized: false };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

export function dbSsl(connectionString: string | undefined): DbSsl {
  if (!connectionString) return false;

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    // Not parseable as a URL (a libpq keyword string, say). Assume remote —
    // failing closed here means a TLS attempt, not a plaintext one.
    return { rejectUnauthorized: false };
  }

  const mode = url.searchParams.get('sslmode');
  if (mode === 'disable') return false;
  if (mode) return { rejectUnauthorized: false };

  // `new URL('postgres://[::1]:5432/db').hostname` keeps the brackets.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  return LOCAL_HOSTS.has(host) ? false : { rejectUnauthorized: false };
}

import { describe, expect, it } from 'vitest';
import { dbSsl } from '@/db/ssl';

/**
 * The whole reason this decision is a function rather than a literal is that CI
 * runs the integration suite against a Postgres service container, which speaks
 * no TLS, while Railway requires it (D-024). Get this wrong in either direction
 * and the failure is a connection reset with no useful message.
 */
describe('dbSsl', () => {
  it('uses TLS against a remote host', () => {
    expect(dbSsl('postgres://app_user:pw@nozomi.proxy.rlwy.net:57355/railway')).toEqual({
      rejectUnauthorized: false,
    });
  });

  it('does not attempt TLS against a local host', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]', '0.0.0.0']) {
      expect(dbSsl(`postgres://app_user:pw@${host}:5432/app`), host).toBe(false);
    }
  });

  it('honours an explicit sslmode', () => {
    expect(dbSsl('postgres://u:p@db.example.com/app?sslmode=disable')).toBe(false);
    expect(dbSsl('postgres://u:p@localhost/app?sslmode=require')).toEqual({
      rejectUnauthorized: false,
    });
  });

  it('fails closed on a keyword string — assumes remote, so TLS', () => {
    expect(dbSsl('host=db.example.com user=app_user')).toEqual({ rejectUnauthorized: false });
  });

  it('returns false when there is no connection string at all', () => {
    // Nothing to connect to; the client will raise its own, clearer error.
    expect(dbSsl(undefined)).toBe(false);
  });
});

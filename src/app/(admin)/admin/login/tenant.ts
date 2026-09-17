/**
 * Which tenant a signed-out staff browser is talking to.
 *
 * ─── The open question this does NOT answer ────────────────────────────────
 *
 * `login()` needs a tenant, and so does accepting an invite, and how a browser
 * establishes which tenant it is talking to is part of the tenancy model —
 * CLAUDE.md says ask before changing that, so this does not.
 *
 * `STAFF_TENANT_ID` is an explicit stopgap for the single-tenant demo. The two
 * real answers, both a decision rather than a refactor:
 *
 *   1. Subdomain — `kesari.hgs.app` resolves to a tenant. Standard, works with
 *      one login form, and needs wildcard DNS and a certificate.
 *   2. An email → tenant lookup through a SECURITY DEFINER function, exactly
 *      like `resolve_qr_routing()` (migration 0003) does for a QR scan. Same
 *      shape of problem: a caller with no tenant context needs routing
 *      information and nothing else.
 *
 * Extracted here in P3.5 so the two signed-out pages share ONE answer. When it
 * is chosen, it is chosen in this file and nowhere else.
 */
export function staffTenantId(): string | null {
  return process.env.STAFF_TENANT_ID ?? null;
}

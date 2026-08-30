-- 0003_qr_routing.sql — the one pre-tenant lookup, done safely
--
-- A guest arrives at /r/{publicCode} carrying nothing. Resolving that code is
-- HOW we learn which tenant the request belongs to, so it cannot run inside
-- withTenant() — but app_user is subject to RLS, and with no `app.tenant_id`
-- set the policies correctly return zero rows. Without something here, a scan
-- can never resolve at all.
--
-- The wrong fixes, and why:
--   * connect as the owner  — bypasses RLS for everything, not just this
--   * loosen the RLS policy on room_qr_codes — RLS is row-level, not
--     column-level, so it would expose whole rows tenant-wide
--   * put tenant_id in the URL — leaks the tenancy structure to the corridor
--
-- The right fix is a SECURITY DEFINER function: a single fixed statement,
-- owned by the migration role, returning ROUTING IDS ONLY. There is no query
-- builder behind it and no way for a caller to widen it. Knowing a public code
-- grants room context and nothing else, which is exactly D-012's design.

CREATE OR REPLACE FUNCTION resolve_qr_routing(p_public_code text)
RETURNS TABLE (
  tenant_id   uuid,
  property_id uuid,
  room_id     uuid,
  qr_code_id  uuid,
  version     integer,
  revoked_at  timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
-- Pinned so a caller cannot shadow `room_qr_codes` with a temp table and have
-- the definer read it instead. Mandatory for SECURITY DEFINER.
SET search_path = public, pg_temp
AS $$
  SELECT q.tenant_id, q.property_id, q.room_id, q.id, q.version, q.revoked_at
  FROM public.room_qr_codes q
  WHERE q.public_code = p_public_code
  LIMIT 1;
$$;

-- Nobody may execute it by default; app_user is granted it explicitly.
REVOKE ALL ON FUNCTION resolve_qr_routing(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_qr_routing(text) TO app_user;

COMMENT ON FUNCTION resolve_qr_routing(text) IS
  'Pre-tenant routing lookup for /r/[code]. Returns routing ids only — never '
  'guest, stay or folio data. Everything downstream must go through withTenant().';

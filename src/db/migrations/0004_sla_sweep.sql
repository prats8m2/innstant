-- 0004_sla_sweep.sql — letting a background job find work it may then do properly
--
-- The SLA sweep has the same shape of problem the QR lookup had (0003) and the
-- opposite cause. A guest arriving at /r/{code} carries no tenant; a sweep
-- running on a timer carries no REQUEST, so there is nothing to derive a tenant
-- from either. `app_user` under RLS with no `app.tenant_id` correctly sees zero
-- rows, so a sweep written the obvious way finds nothing, forever, silently.
--
-- The wrong fixes, and why:
--   * connect the worker as the owner — bypasses RLS for every table, and
--     D-025 deliberately keeps owner credentials out of the deployed image
--   * loosen RLS on service_requests — row-level, so it would expose whole
--     rows across tenants to every request path, not just this one
--   * keep a list of tenants in an env var — wrong the day a property is added,
--     and nobody would notice until a breach went unescalated
--
-- The right fix is the same as 0003: a SECURITY DEFINER function with one fixed
-- statement, returning ROUTING IDS ONLY. It answers "which properties have work
-- that might need escalating" and nothing else — no request, no guest, no
-- amounts. The sweep then re-enters through withTenant() per property and does
-- the actual reading and writing under RLS like everything else.

CREATE OR REPLACE FUNCTION sla_sweep_properties()
RETURNS TABLE (
  tenant_id   uuid,
  property_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
-- Pinned, so a caller cannot shadow `service_requests` with a temp table and
-- have the definer read that instead. Mandatory for SECURITY DEFINER.
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT sr.tenant_id, sr.property_id
  FROM public.service_requests sr
  WHERE sr.status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS')
    AND sr.sla_target_at IS NOT NULL
    AND sr.sla_target_at < now()
    AND sr.escalation_level < 3
$$;

REVOKE ALL ON FUNCTION sla_sweep_properties() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sla_sweep_properties() TO app_user;

COMMENT ON FUNCTION sla_sweep_properties() IS
  'Which properties have a breached, un-escalated service request. Returns ids '
  'only — the sweep re-enters through withTenant() to read or write anything.';

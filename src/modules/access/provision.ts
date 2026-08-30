import { eq } from 'drizzle-orm';
import type { Tx } from '@/db';
import { accessPolicies } from '@/db/schema/access';

/**
 * The default access policy for a new property. D-012.
 *
 * These defaults ARE the product decision: a bare scan grants REQUEST, and the
 * single verification prompt appears only at the first attempt to charge to the
 * room. A property may tighten this, but shipping it tightened by default would
 * reproduce the design D-012 explicitly rejected.
 */
export async function createDefaultAccessPolicy(
  tx: Tx,
  input: { tenantId: string; propertyId: string },
): Promise<string> {
  const existing = await tx.select({ id: accessPolicies.id })
    .from(accessPolicies)
    .where(eq(accessPolicies.propertyId, input.propertyId))
    .limit(1);
  if (existing[0]) return existing[0].id;

  const [row] = await tx.insert(accessPolicies).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    baseTier: 'REQUEST',
    escalationTrigger: 'FIRST_CHARGE',
  }).returning({ id: accessPolicies.id });
  return row!.id;
}

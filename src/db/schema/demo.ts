import { pgTable, text, index } from 'drizzle-orm/pg-core';
import { pk, createdAt } from './_shared';

/**
 * Visitors who tried the demo from the marketing site (0007).
 *
 * The only table here with no `tenant_id`, and the migration explains why at
 * length: a stranger on a marketing page has no tenant to belong to. What
 * protects it is not tenant isolation but an asymmetry — the app may INSERT and
 * can never SELECT, enforced by forced RLS with a single INSERT policy.
 *
 * Deliberately thin. A name, what they were shown, and when. It is a guest
 * book, not a CRM: there is no email, no company, no scoring, and nothing here
 * is used to decide anything.
 */
export const demoVisitors = pgTable('demo_visitors', {
  id: pk(),
  name: text('name').notNull(),
  /** The room they were dropped into, so the row still means something after a
   *  reseed renumbers the demo property. */
  roomNumber: text('room_number'),
  userAgent: text('user_agent'),
  createdAt: createdAt(),
}, (t) => [index('demo_visitors_created_idx').on(t.createdAt)]);

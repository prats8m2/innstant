import type { PmsAdapter, PmsEvent } from './types';

/**
 * The adapter for a property whose system of record is this product.
 *
 * `ManualAdapter` is deliberately a sink that is never called. There is no
 * remote to tell: the front desk checks people in here (`/admin/rooms`), the
 * folio lives here, and `stays` is the record. `deliversOutbound` is false, so
 * the enqueue sites write nothing and the outbox stays empty rather than
 * accumulating rows for a queue with no consumer.
 *
 * ─── Why it exists if it does nothing ──────────────────────────────────────
 *
 * It is what makes `deliversOutbound` a question the code asks rather than an
 * assumption it makes. Every stay change already goes past the check; an
 * `OperaAdapter` flips it to true and the same call sites start filling the
 * outbox with no edit. That is the difference between a seam and a comment
 * saying there should be one.
 *
 * `deliver()` throws rather than resolving quietly. A no-op would let a mistake
 * — enqueuing for a manual property, or resolving the wrong adapter — look like
 * successful delivery to a PMS that does not exist, and the outbox row would be
 * marked DELIVERED with nothing on the other end.
 */
export const ManualAdapter: PmsAdapter = {
  kind: 'MANUAL',
  deliversOutbound: false,

  async deliver(event: PmsEvent): Promise<never> {
    throw new Error(
      `ManualAdapter has nowhere to deliver ${event.kind} to. `
      + 'This property has no external PMS, so nothing should have been enqueued '
      + 'for it — check the adapter resolution rather than making this a no-op.',
    );
  },
};

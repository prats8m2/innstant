/**
 * The boundary to reservation data. D-011, EXTENSION-POINTS §B.
 *
 * "Everything outside `modules/stay/` talks to reservations through this
 * interface. A v2 booking module is simply `InternalPmsAdapter`. Guard the
 * interface more carefully than the schema."
 *
 * ─── What this interface is, having met the code ───────────────────────────
 *
 * The sketch in EXTENSION-POINTS reads as a facade over every stay operation —
 * `findStayByRoom`, `checkIn`, `checkOut`, `extendStay`, `postCharge`. Written
 * that way it would be wrong in two specific ways, and both are worth stating
 * because the sketch is what somebody will reach for next.
 *
 * **A remote system cannot be inside our transaction.** Approving a late
 * checkout moves the stay, posts a fee and extends every session in ONE
 * transaction (D-033), and checking out does four things in one (D-035). An
 * `extendStay()` that makes an HTTPS call in the middle of that either holds a
 * database transaction open across the network or commits half the work. The
 * PMS being down must never fail a guest's order (DATA-MODEL §8), which settles
 * it: the local write is authoritative and synchronous, and the PMS is told
 * afterwards through `integration_outbox`.
 *
 * **The local table is the answer to every read.** Every stay exists in `stays`
 * whatever produced it, because `createStay()` is the one door (#4) — a PMS
 * import is a caller, not a bypass. So `findStayByRoom` has no caller here and
 * would be an unused method pretending to be a seam.
 *
 * What is left is the half that is genuinely someone else's: **telling the
 * system of record what happened.** That is what an adapter implements, and it
 * is called by the outbox drain, never by a request.
 */

export type PmsKind = 'MANUAL' | 'OPERA' | 'CLOUDBEDS' | 'EZEE';

/** Where a stay lives, in terms both sides understand. Never our uuids alone. */
export interface StayRef {
  stayId: string;
  /** The PMS's own id for it — `stays.source_ref_id` (EXTENSION-POINTS §3). */
  sourceRefId: string | null;
  roomNumber: string;
}

/**
 * The four things that happen here which a system of record needs to know.
 *
 * A closed union rather than a string and a blob: adding a fifth is a compile
 * error in every adapter, which is the point of guarding the interface. The
 * payloads carry room numbers and minor units — the PMS does not know our uuids
 * and money crosses the boundary the way it does everywhere else (#5).
 */
export type PmsEvent =
  | {
    kind: 'STAY_CHECKED_IN';
    stay: StayRef;
    guest: { fullName: string; phone: string | null };
    checkedInAt: string;
    scheduledCheckoutAt: string;
  }
  | {
    kind: 'STAY_CHECKED_OUT';
    stay: StayRef;
    checkedOutAt: string;
    /** What was still on the folio when they left (D-035). */
    balanceMinor: number;
    currency: string;
  }
  | {
    kind: 'STAY_EXTENDED';
    stay: StayRef;
    scheduledCheckoutAt: string;
    reason: 'LATE_CHECKOUT';
  }
  | {
    kind: 'CHARGE_POSTED';
    stay: StayRef;
    description: string;
    amountMinor: number;
    currency: string;
    /** Our folio line id. The PMS's dedupe key on a retry. */
    folioLineId: string;
  };

export type PmsEventKind = PmsEvent['kind'];

export interface PmsAdapter {
  readonly kind: PmsKind;

  /**
   * Whether this property has a system of record to tell at all.
   *
   * False for `ManualAdapter`, and that is not a stub — a hotel whose front desk
   * IS this product has nowhere to push to, and enqueuing an outbox row per
   * folio line for a queue nothing drains would be write-only rows at table
   * scale. The enqueue sites check this, so a manual property writes none.
   */
  readonly deliversOutbound: boolean;

  /**
   * Tell the system of record. Called by the outbox drain, never by a request.
   *
   * Throwing means "not delivered, try again" — the drain records the message
   * and backs off. Returning means the PMS has it, and the row is done.
   */
  deliver(event: PmsEvent): Promise<void>;
}

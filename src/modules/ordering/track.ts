import type { OrderStatus } from './transitions';

/**
 * What the guest is told, and when.
 *
 * The kitchen's state machine has eleven statuses (transitions.ts). A guest
 * waiting for dinner does not want eleven; the design reference draws five
 * steps on a vertical timeline, and this is the map between them.
 *
 * Pure — no database, no clock, no formatting. The screen renders what it gets
 * and the property's timezone decides how a time reads (CLAUDE.md "Dates").
 * That is also what makes the mapping testable, which matters more here than
 * it looks: this is the one place a status the machine can reach might have no
 * step to stand on, and the failure mode is a guest staring at a screen that
 * says nothing is happening.
 */

/** The five steps, in order, exactly as the reference names them. */
export const TRACK_STEPS = [
  {
    key: 'RECEIVED',
    title: 'Order received',
    /** Reached by PLACED, and by everything after it. */
    statuses: ['PLACED'] as const,
  },
  {
    key: 'KITCHEN',
    title: 'In the kitchen',
    statuses: ['ACCEPTED', 'PREPARING'] as const,
  },
  {
    key: 'PLATED',
    title: 'Plated and covered',
    statuses: ['READY'] as const,
  },
  {
    key: 'ON_THE_WAY',
    title: 'On the way up',
    statuses: ['OUT_FOR_DELIVERY'] as const,
  },
  {
    key: 'AT_YOUR_DOOR',
    title: 'At your door',
    statuses: ['DELIVERED', 'CLOSED'] as const,
  },
] as const;

export type TrackStepKey = (typeof TRACK_STEPS)[number]['key'];

/**
 * The line under each step.
 *
 * Keyed by STATUS rather than by step, because "In the kitchen" reads
 * differently the moment a pan is on, and that difference is the only thing
 * the guest gets between ACCEPTED and PREPARING.
 *
 * No staff names here. The reference writes "Bhairav has started cooking" and
 * "Kishan is crossing the third courtyard", which is the right voice — but a
 * name has to come from a row, and until the runner assignment has a screen
 * (STATUS: `assignedRunnerId` is written, nothing reads it) inventing one would
 * put a fiction in front of a guest.
 */
const SUB: Partial<Record<OrderStatus, string>> = {
  PLACED: 'The kitchen has it on the board.',
  ACCEPTED: 'Taken. Nothing on the pan yet.',
  PREPARING: 'Cooking to order.',
  READY: 'Tray set, waiting on a runner.',
  OUT_FOR_DELIVERY: 'Crossing the courtyard now.',
  DELIVERED: 'Left with you. Nothing else to do.',
  CLOSED: 'Left with you. Nothing else to do.',
};

/** The line a step shows before it has been reached. */
const PENDING_SUB: Record<TrackStepKey, string> = {
  RECEIVED: 'Sending it through.',
  KITCHEN: 'The kitchen will take it from the board.',
  PLATED: 'Plated and covered when it comes off the pan.',
  ON_THE_WAY: 'A runner brings it up.',
  AT_YOUR_DOOR: 'They will knock. No bell after 10.',
};

/**
 * The same timeline, in the words the destination actually deserves. D-080.
 *
 * Everything above is written for a tray going to a hotel room, because until
 * D-079 that was the only thing an order could be: "On the way up", "Crossing
 * the courtyard", "They will knock. No bell after 10." All of it is true of
 * room 214 and none of it is true of somebody waiting at a counter or at
 * 12 MG Road — and it was being shown to them, on the web `/p` screen and in
 * the API's first response, which is how it was found.
 *
 * Only the lines that ARE different are overridden. RECEIVED and KITCHEN are
 * the same event wherever the food is going, so they fall through to the
 * tables above rather than being restated three times — restating them is how
 * one copy of a sentence quietly stops matching the other three.
 *
 * `IN_ROOM` is absent on purpose: it is the fallback, and giving it an entry
 * would mean two places to change the room wording.
 */
export type TrackFulfilment = 'IN_ROOM' | 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';

interface StepCopy {
  title?: string;
  /** Keyed by status, for the line a REACHED step shows. */
  sub?: Partial<Record<OrderStatus, string>>;
  /** The line shown before the step is reached. */
  pending?: string;
}

const BY_FULFILMENT: Record<
  Exclude<TrackFulfilment, 'IN_ROOM'>,
  Partial<Record<TrackStepKey, StepCopy>>
> = {
  DINE_IN: {
    PLATED: {
      sub: { READY: 'Plated, waiting to be carried over.' },
      pending: 'Plated when it comes off the pan.',
    },
    ON_THE_WAY: {
      title: 'Coming to your table',
      sub: { OUT_FOR_DELIVERY: 'On its way across now.' },
      pending: 'Someone brings it over.',
    },
    AT_YOUR_DOOR: {
      title: 'At your table',
      sub: {
        DELIVERED: 'On the table. Nothing else to do.',
        CLOSED: 'On the table. Nothing else to do.',
      },
      pending: 'Served at your table.',
    },
  },

  TAKEAWAY: {
    PLATED: {
      title: 'Bagged up',
      sub: { READY: 'Bagged and waiting at the counter.' },
      pending: 'Bagged when it comes off the pan.',
    },
    ON_THE_WAY: {
      title: 'Ready for you',
      sub: { OUT_FOR_DELIVERY: 'Waiting at the counter — come and get it.' },
      pending: 'We will call your name.',
    },
    AT_YOUR_DOOR: {
      title: 'Collected',
      sub: {
        DELIVERED: 'Handed over. Nothing else to do.',
        CLOSED: 'Handed over. Nothing else to do.',
      },
      pending: 'Picked up at the counter.',
    },
  },

  DELIVERY: {
    PLATED: {
      title: 'Packed',
      sub: { READY: 'Packed, waiting on a rider.' },
      pending: 'Packed when it comes off the pan.',
    },
    ON_THE_WAY: {
      title: 'On its way',
      sub: { OUT_FOR_DELIVERY: 'A rider has it.' },
      pending: 'A rider brings it to you.',
    },
    AT_YOUR_DOOR: {
      sub: {
        DELIVERED: 'Delivered. Nothing else to do.',
        CLOSED: 'Delivered. Nothing else to do.',
      },
      pending: 'They will call when they are outside.',
    },
  },
};

function copyFor(key: TrackStepKey, fulfilment: TrackFulfilment): StepCopy {
  if (fulfilment === 'IN_ROOM') return {};
  return BY_FULFILMENT[fulfilment][key] ?? {};
}

export type TrackStepState = 'done' | 'active' | 'pending';

export interface TrackStep {
  key: TrackStepKey;
  title: string;
  sub: string;
  state: TrackStepState;
  /** The moment this step was reached, or null if it has not been. */
  at: Date | null;
}

/** The timestamps `orders` stamps as it moves — see STATUS_TIMESTAMP. */
export interface OrderStamps {
  placedAt?: Date | null;
  acceptedAt?: Date | null;
  preparingAt?: Date | null;
  readyAt?: Date | null;
  outForDeliveryAt?: Date | null;
  deliveredAt?: Date | null;
  closedAt?: Date | null;
}

/** Which stamp says a step was reached. First non-null wins. */
const STAMPS: Record<TrackStepKey, ReadonlyArray<keyof OrderStamps>> = {
  RECEIVED: ['placedAt'],
  // ACCEPTED may be skipped in the data if a kitchen bumps straight through;
  // the earlier stamp is the truthful one when both exist.
  KITCHEN: ['acceptedAt', 'preparingAt'],
  PLATED: ['readyAt'],
  ON_THE_WAY: ['outForDeliveryAt'],
  AT_YOUR_DOOR: ['deliveredAt', 'closedAt'],
};

function indexOfStatus(status: OrderStatus): number {
  return TRACK_STEPS.findIndex((step) => (step.statuses as readonly OrderStatus[]).includes(status));
}

/**
 * A guest-facing halt: the order is not coming, and the screen must say so
 * instead of animating a timeline forever.
 */
export interface TrackHalt {
  title: string;
  detail: string;
  /** The reason the kitchen or the desk gave, verbatim. */
  reason: string | null;
}

export interface TrackView {
  /** null when the order stopped — render `halt` instead. */
  steps: TrackStep[] | null;
  halt: TrackHalt | null;
  /** True while the order is still moving; the screen only streams when it is. */
  live: boolean;
}

/**
 * The whole screen's state, from a status and the stamps.
 *
 * REJECTED and CANCELLED do not get a greyed-out timeline. A guest whose
 * dinner is not coming needs one sentence and a reason, at the top, not a
 * progress diagram with a full stop in the middle of it — the same reasoning
 * that made REJECTED a first-class transition rather than a silent failure.
 */
export function trackView(
  status: OrderStatus,
  stamps: OrderStamps = {},
  /** `rejection_reason` or `cancellation_reason` — shown to the guest verbatim. */
  reason: string | null = null,
  /**
   * Where the food is going, which decides the wording of the last three steps
   * (D-080). Defaults to IN_ROOM so every caller written before property links
   * existed keeps the copy it was written against — and so a caller that
   * forgets it gets the room wording rather than nothing.
   */
  fulfilment: TrackFulfilment = 'IN_ROOM',
): TrackView {
  if (status === 'REJECTED') {
    return {
      steps: null,
      live: false,
      halt: {
        title: 'The kitchen could not make this',
        /**
         * This can say "nothing has been charged" because it is now true.
         * `placeOrder()` posts the folio line at placement and the REJECTED
         * transition credits it back in the same transaction — see the reversal
         * in `advanceOrder()`. If that ever stops being true, this sentence is
         * the first thing that has to change, and `track.test.ts` says so.
         *
         * It promises a NET of zero, not the existence of a credit row: an
         * order that never posted a charge — a cancelled DRAFT, or a seeded
         * demo order — has nothing to credit and the sentence is still true.
         */
        detail: 'Nothing has been charged for it. Order something else, or call the desk.',
        reason,
      },
    };
  }

  if (status === 'CANCELLED') {
    return {
      steps: null,
      live: false,
      halt: {
        title: 'This order was cancelled',
        detail: 'Nothing has been charged for it.',
        reason,
      },
    };
  }

  if (status === 'DISPUTED') {
    return {
      steps: null,
      live: false,
      halt: {
        title: 'The desk is looking at this order',
        detail: 'Someone will come to you about it before checkout.',
        reason,
      },
    };
  }

  // DRAFT never leaves placeOrder(), so it cannot be read here — but a guest
  // arriving with a stale link deserves the truthful answer rather than a
  // timeline whose first step has not happened.
  const current = status === 'DRAFT' ? -1 : indexOfStatus(status);

  const steps = TRACK_STEPS.map((step, i): TrackStep => {
    const state: TrackStepState = i < current ? 'done' : i === current ? 'active' : 'pending';
    const at = STAMPS[step.key]
      .map((field) => stamps[field] ?? null)
      .find((value): value is Date => value instanceof Date) ?? null;

    // Each override falls back to the room copy, so a fulfilment only has to
    // say what is actually different about it.
    const copy = copyFor(step.key, fulfilment);
    const pending = copy.pending ?? PENDING_SUB[step.key];

    return {
      key: step.key,
      title: copy.title ?? step.title,
      sub: state === 'pending'
        ? pending
        : copy.sub?.[status] ?? SUB[status] ?? pending,
      state,
      // A step in the future has no time, even if a stamp exists — which it
      // can, out of order, if a kitchen bumps backwards through a correction.
      at: state === 'pending' ? null : at,
    };
  });

  // Only the ACTIVE step takes the status's line. Steps already behind it keep
  // their own, or the screen reads "Cooking to order" three times.
  for (const [i, step] of steps.entries()) {
    if (step.state !== 'done') continue;
    const reached = TRACK_STEPS[i]?.statuses[0];
    if (!reached) continue;
    const copy = copyFor(step.key, fulfilment);
    step.sub = copy.sub?.[reached] ?? SUB[reached] ?? step.sub;
  }

  // Live while a step is still ahead. Once the tray is at the door nothing the
  // machine can do afterwards (CLOSED at checkout, DISPUTED at the desk) is
  // news to the guest standing there holding it, so the stream can close.
  return { steps, halt: null, live: current < TRACK_STEPS.length - 1 };
}

/**
 * How far along, for something too small to draw the timeline.
 *
 * A home-screen card has room for five segments and no room for five titles.
 * It gets a POSITION rather than a `TrackView` it would have to count: 1-based
 * over `TRACK_STEPS`, and `of` so that the number of segments travels with the
 * position instead of being assumed at the other end.
 *
 * That last part is the reason this exists as a function rather than as
 * arithmetic in the serialiser. `TRACK_STEPS` is FIVE — ACCEPTED and PREPARING
 * are one step on purpose, with the difference carried in the sub-line — and
 * anything counting statuses instead would draw six and light the wrong one.
 * An app holding either number is holding half a state machine.
 *
 * Zero for everything that is not on the timeline at all: the three halted
 * statuses, which `trackView()` answers with a sentence rather than a
 * progress diagram, and DRAFT, which never leaves `placeOrder()`.
 */
export interface TrackProgress {
  index: number;
  of: number;
}

export function trackProgress(status: OrderStatus): TrackProgress {
  const of = TRACK_STEPS.length;
  if (status === 'DRAFT') return { index: 0, of };
  if (status === 'REJECTED' || status === 'CANCELLED' || status === 'DISPUTED') {
    return { index: 0, of };
  }
  // `findIndex` returns -1 for a status with no step, which would read as a
  // position rather than as an absence. There is no such status today and
  // `track.test.ts` is exhaustive over ORDER_STATUSES so that there cannot be
  // one tomorrow without this being looked at.
  const found = indexOfStatus(status);
  return { index: found < 0 ? 0 : found + 1, of };
}

/**
 * The promise at the top of the screen.
 *
 * A window, not a single minute, for as long as the answer is genuinely a
 * window — a kitchen that says "9:41pm" and knocks at 9:48 has broken a
 * promise it never needed to make. It narrows to one time once a runner is
 * carrying the tray, and becomes the past tense once it is handed over.
 *
 * Dates, not strings: the property's timezone decides how these read, and that
 * belongs to the screen (CLAUDE.md "Dates").
 */
export const ETA_WINDOW_MINUTES = 12;

export interface TrackEta {
  label: 'Arriving between' | 'Arriving by' | 'Arrived at';
  from: Date;
  /** null when the answer is one time rather than a window. */
  to: Date | null;
}

export function trackEta(
  status: OrderStatus,
  promisedByAt: Date | null,
  stamps: OrderStamps = {},
): TrackEta | null {
  const delivered = stamps.deliveredAt ?? stamps.closedAt ?? null;
  if (delivered && (status === 'DELIVERED' || status === 'CLOSED')) {
    return { label: 'Arrived at', from: delivered, to: null };
  }

  // Nothing to promise: a halted order, or an order placed before the outlet
  // had a prep time. Better a screen with no promise than an invented one.
  if (!promisedByAt) return null;
  if (status === 'REJECTED' || status === 'CANCELLED' || status === 'DISPUTED') return null;

  if (status === 'OUT_FOR_DELIVERY' || status === 'DELIVERED' || status === 'CLOSED') {
    return { label: 'Arriving by', from: promisedByAt, to: null };
  }

  return {
    label: 'Arriving between',
    from: promisedByAt,
    to: new Date(promisedByAt.getTime() + ETA_WINDOW_MINUTES * 60_000),
  };
}

/**
 * One line of state per order, for a LIST.
 *
 * Deliberately coarser than the five steps above: a timeline is read, a list is
 * scanned. "Plated and covered" versus "On the way up" is a distinction worth a
 * whole screen and not worth a row — tapping through gets the timeline.
 *
 * It lives here rather than in the screen for the reason the file header
 * already gives: this is where a status the machine can reach might end up with
 * nothing to stand on. `trackView()` has that risk for the timeline; this has
 * it for the list, and `track.test.ts` holds both to the same standard —
 * EVERY member of ORDER_STATUSES must have a line of its own.
 *
 * `tone` is what the screen colours by, not a colour: `stopped` is the only one
 * that earns the critical tone, because it is the only one where something the
 * guest asked for is not coming.
 */
export type OrderStateTone = 'open' | 'done' | 'stopped';

export interface OrderState {
  label: string;
  tone: OrderStateTone;
  /** Short enough for a one-line strip on the room home. */
  short: string;
}

const ORDER_STATE: Record<OrderStatus, OrderState> = {
  // Never shown: a DRAFT is the cart, and `listOrdersForStay` filters it out.
  // It is here so the record is exhaustive and the test can say so.
  DRAFT: { label: 'Not sent yet', tone: 'open', short: 'Not sent yet' },
  PLACED: { label: 'With the kitchen', tone: 'open', short: 'Order with the kitchen' },
  ACCEPTED: { label: 'Being cooked', tone: 'open', short: 'Your order is being cooked' },
  PREPARING: { label: 'Being cooked', tone: 'open', short: 'Your order is being cooked' },
  READY: { label: 'Ready for the runner', tone: 'open', short: 'Your order is on its way up' },
  OUT_FOR_DELIVERY: { label: 'On its way up', tone: 'open', short: 'Your order is on its way up' },
  DELIVERED: { label: 'Delivered', tone: 'done', short: 'Delivered' },
  CLOSED: { label: 'Delivered', tone: 'done', short: 'Delivered' },
  REJECTED: { label: 'Could not be made', tone: 'stopped', short: 'The kitchen could not make it' },
  CANCELLED: { label: 'Cancelled', tone: 'stopped', short: 'Cancelled' },
  DISPUTED: { label: 'Being looked into', tone: 'open', short: 'Being looked into' },
};

export function orderStateFor(status: OrderStatus): OrderState {
  return ORDER_STATE[status];
}

/** Still moving — what belongs under "Happening now" rather than in the history. */
export const OPEN_TO_A_GUEST: readonly OrderStatus[] = [
  'PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY',
];

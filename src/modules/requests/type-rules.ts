/**
 * The rules a property may not edit its way around.
 *
 * Pure and separate from `admin.ts` so they can be tested without a database,
 * and so the two that are load-bearing on CLAUDE.md's non-negotiables are in one
 * readable file rather than buried in an UPDATE.
 */

export const REQUEST_CATEGORIES = [
  'AMENITY', 'HOUSEKEEPING', 'SERVICE', 'MAINTENANCE',
] as const;

export type RequestCategory = (typeof REQUEST_CATEGORIES)[number];

/** How a category reads on a screen, and the order the four are shown in. */
export const CATEGORY_LABELS: Readonly<Record<RequestCategory, string>> = {
  AMENITY: 'Amenities',
  HOUSEKEEPING: 'Housekeeping',
  SERVICE: 'Service',
  MAINTENANCE: 'Maintenance',
};

/**
 * The shortest and longest promise a property may make.
 *
 * The floor is 1 rather than 0 because a zero-minute target is breached the
 * instant it is written, and the sweep would escalate it before anybody could
 * pick it up — a setting whose only effect is to fill the duty manager's bell.
 * The ceiling is eight hours: past that it is not a service request, it is a
 * maintenance job, and the SLA machinery stops meaning anything.
 */
export const SLA_MINUTES_MIN = 1;
export const SLA_MINUTES_MAX = 480;

/** A stepper that cannot step is a stepper nobody wants. */
export const MAX_QUANTITY_CEILING = 20;

/**
 * The one-tap service call, which may never carry a price.
 *
 * CLAUDE.md #9: "Menus, prices, POIs and free service calls must work with zero
 * screens in the way." `raiseServiceRequest()` requires the CHARGE tier as soon
 * as a request totals more than zero, so putting ₹1 on this key turns the
 * reference's one tap into a verification prompt — which is the exact screen #9
 * exists to keep out of the way. A property that wants to charge for something
 * can add a type; it cannot reprice this one.
 */
export const UNPRICEABLE_KEYS: readonly string[] = ['CALL_SERVICE'];

export interface RequestTypeRules {
  key: string;
  priceMinor: number;
  slaMinutes: number;
  allowsQuantity: boolean;
  maxQuantity: number;
  category: string;
}

export interface RuleViolation {
  field: 'priceMinor' | 'slaMinutes' | 'maxQuantity' | 'category';
  message: string;
}

/** The first thing wrong with it, or null. Guest-facing tone: what and what to do. */
export function checkRequestTypeRules(input: RequestTypeRules): RuleViolation | null {
  if (!REQUEST_CATEGORIES.includes(input.category as RequestCategory)) {
    return { field: 'category', message: 'Pick one of the four categories.' };
  }

  if (!Number.isInteger(input.priceMinor) || input.priceMinor < 0) {
    return { field: 'priceMinor', message: 'A price cannot be negative. Leave it blank for free.' };
  }

  if (input.priceMinor > 0 && UNPRICEABLE_KEYS.includes(input.key)) {
    return {
      field: 'priceMinor',
      message:
        'Calling for service has to stay free. A price on it would ask the guest '
        + 'to verify who they are before anyone comes up. Add a separate type if '
        + 'you need to charge for something.',
    };
  }

  if (!Number.isInteger(input.slaMinutes)
      || input.slaMinutes < SLA_MINUTES_MIN || input.slaMinutes > SLA_MINUTES_MAX) {
    return {
      field: 'slaMinutes',
      message: `Promise between ${SLA_MINUTES_MIN} and ${SLA_MINUTES_MAX} minutes.`,
    };
  }

  if (input.allowsQuantity
      && (!Number.isInteger(input.maxQuantity)
        || input.maxQuantity < 2 || input.maxQuantity > MAX_QUANTITY_CEILING)) {
    return {
      field: 'maxQuantity',
      message: `If a guest may ask for more than one, the most is between 2 and ${MAX_QUANTITY_CEILING}.`,
    };
  }

  return null;
}

/**
 * The two values a property does not get to set independently.
 *
 * **`isChargeable` follows the price.** The guest's amenities screen prints
 * "Free" or the amount from this flag, and `raiseServiceRequest()` decides
 * whether to demand verification from the TOTAL. Let them disagree and the worst
 * case is a screen that says Free above a request that charges the room and
 * asks the guest to prove who they are — which is #9 broken by a checkbox. One
 * number, not two, the same way `slaMinutes` is the promise and the deadline.
 *
 * **`maxQuantity` follows `allowsQuantity`.** A type with no stepper has a max
 * of one whatever is in the box, so a later "allow more than one" cannot
 * silently inherit a 6 somebody typed and abandoned months ago.
 */
export function deriveRequestTypeFields(input: {
  priceMinor: number;
  allowsQuantity: boolean;
  maxQuantity: number;
}): { isChargeable: boolean; maxQuantity: number } {
  return {
    isChargeable: input.priceMinor > 0,
    maxQuantity: input.allowsQuantity ? input.maxQuantity : 1,
  };
}

/**
 * A stable key from what the manager typed.
 *
 * Keys are how code finds a type it must know about (`CALL_SERVICE_KEY`) and
 * what survives a rename — "Call for service" becoming "Ring for the butler"
 * must not change it. So one is minted once, at creation, from the name, and
 * never touched again.
 *
 * Returns null when nothing usable survives — a name of only punctuation, or of
 * a script this transliterates nothing of. The caller asks for a different name
 * rather than storing an empty key.
 */
export function requestTypeKeyFrom(name: string): string | null {
  const key = name
    .normalize('NFKD')
    // Strip combining marks so "Café" is CAFE rather than CAF.
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
    .replace(/_+$/g, '');

  return key || null;
}

/**
 * `EXTRA_TOWELS`, `EXTRA_TOWELS_2`, `EXTRA_TOWELS_3`…
 *
 * Two types can legitimately be called the same thing at different properties,
 * but not at one — the key is unique per property, and a manager adding a second
 * "Extra towels" should get a second row rather than a constraint error they
 * cannot act on.
 */
export function uniqueRequestTypeKey(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base.slice(0, 44)}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error('No free key for this name.');
}

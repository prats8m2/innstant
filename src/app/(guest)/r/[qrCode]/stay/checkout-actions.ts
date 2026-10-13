'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withTenant } from '@/db';
import { resolveStaySession, GUEST_SESSION_COOKIE, requireTier } from '@/modules/access';
import { findProperty } from '@/modules/identity';
import { getCheckoutOptions, requestCheckoutChange, cancelCheckoutRequest } from '@/modules/stay';
import { AppError, publicPayloadFor } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * Asking to leave later, or earlier.
 *
 * ─── Why the fee is not taken from the form ────────────────────────────────
 *
 * The client posts a tier ID and nothing else. The amount is re-derived on the
 * server from the property's own tiers and this stay's checkout time, and THAT
 * is what gets snapshot on the request.
 *
 * A form that posted the price would let a guest with a browser console ask for
 * 6pm at ₹0 — and because the desk's screen shows what the guest agreed to, the
 * fraud would look like an agreement. The screen and the server compute the same
 * number from the same rule; only one of them is trusted.
 *
 * ─── Why it needs FULL ─────────────────────────────────────────────────────
 *
 * `request_checkout` sits on FULL with `view_folio` (D-031), and the guest is
 * already through the prompt by the time they can see these buttons — the
 * options render underneath the folio, on the far side of it. The check is here
 * anyway, because a server action is reachable without the screen that drew it.
 */

export interface CheckoutActionState {
  error?: string;
  done?: string;
}

const Request = z.object({
  qrCode: z.string().min(1).max(64),
  /** The tier, or the word for leaving now. Never an amount. */
  choice: z.string().min(1).max(64),
});

export async function requestCheckout(
  _previous: CheckoutActionState,
  formData: FormData,
): Promise<CheckoutActionState> {
  const parsed = Request.safeParse({
    qrCode: formData.get('qrCode'),
    choice: formData.get('choice'),
  });
  if (!parsed.success) return { error: 'That did not come through. Try again.' };

  const store = await cookies();
  const session = await resolveStaySession(store.get(GUEST_SESSION_COOKIE)?.value);
  if (!session) {
    return { error: 'This link has expired. Scan the code on your nightstand again.' };
  }

  try {
    const check = await requireTier(session, 'request_checkout');
    if (check.required) {
      // Not an escalation prompt here: these controls only render below the
      // folio, which is already behind it. Reaching this without the tier means
      // the action was called directly.
      return { error: 'Open your bill first — we check who you are once.' };
    }

    const done = await withTenant(
      { tenantId: session.tenantId, propertyId: session.propertyId },
      async (tx) => {
        const property = await findProperty(tx, session.propertyId);
        const timeZone = property?.timezone ?? 'Asia/Kolkata';

        const options = await getCheckoutOptions(tx, {
          propertyId: session.propertyId,
          stayId: session.stayId,
          timeZone,
        });

        if (parsed.data.choice === 'NOW') {
          await requestCheckoutChange(tx, {
            tenantId: session.tenantId,
            propertyId: session.propertyId,
            stayId: session.stayId,
            requestedCheckoutAt: new Date(),
            feeMinor: 0,
            currency: options.currency,
            guestSessionId: session.id,
          });
          return 'The desk knows you are leaving. Someone will come up for the key.';
        }

        // Re-derived, never read off the form.
        const offer = options.offers.find((o) => o.id === parsed.data.choice);
        if (!offer) {
          return null;
        }

        await requestCheckoutChange(tx, {
          tenantId: session.tenantId,
          propertyId: session.propertyId,
          stayId: session.stayId,
          requestedCheckoutAt: offer.checkoutAt,
          feeMinor: offer.feeMinor,
          currency: offer.currency,
          guestSessionId: session.id,
        });
        return 'Asked. The desk will confirm shortly — nothing is charged until they do.';
      },
    );

    if (!done) {
      return { error: 'That option is no longer available. Have another look.' };
    }

    logger.info({ stayId: session.stayId, choice: parsed.data.choice }, 'checkout change requested');
    revalidatePath(`/r/${parsed.data.qrCode}/stay`);
    return { done };
  } catch (error) {
    if (error instanceof AppError) return { error: publicPayloadFor(error).message };
    logger.error({ err: (error as Error).message }, 'checkout request failed');
    throw error;
  }
}

const Cancel = z.object({
  qrCode: z.string().min(1).max(64),
  checkoutRequestId: z.uuid(),
});

export async function withdrawCheckoutRequest(
  _previous: CheckoutActionState,
  formData: FormData,
): Promise<CheckoutActionState> {
  const parsed = Cancel.safeParse({
    qrCode: formData.get('qrCode'),
    checkoutRequestId: formData.get('checkoutRequestId'),
  });
  if (!parsed.success) return { error: 'That did not come through. Try again.' };

  const store = await cookies();
  const session = await resolveStaySession(store.get(GUEST_SESSION_COOKIE)?.value);
  if (!session) {
    return { error: 'This link has expired. Scan the code on your nightstand again.' };
  }

  try {
    await withTenant(
      { tenantId: session.tenantId, propertyId: session.propertyId },
      (tx) => cancelCheckoutRequest(tx, {
        tenantId: session.tenantId,
        propertyId: session.propertyId,
        stayId: session.stayId,
        checkoutRequestId: parsed.data.checkoutRequestId,
        guestSessionId: session.id,
      }),
    );

    revalidatePath(`/r/${parsed.data.qrCode}/stay`);
    return { done: 'Withdrawn. Your checkout is unchanged.' };
  } catch (error) {
    if (error instanceof AppError) return { error: publicPayloadFor(error).message };
    logger.error({ err: (error as Error).message }, 'checkout withdrawal failed');
    throw error;
  }
}

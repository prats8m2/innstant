'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  resolveStaySession, GUEST_SESSION_COOKIE,
  requireTier, startPhoneLast4Challenge, answerChallenge,
} from '@/modules/access';
import { AppError, UnauthenticatedError, publicPayloadFor } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * The one prompt, on the way to the folio.
 *
 * `view_folio` needs FULL, and a bare scan grants REQUEST (D-012). So a guest
 * who has not verified meets the prompt here — the same four digits, the same
 * wording, a different reason: this is their own bill, and a QR sticker is
 * photographable from a corridor.
 *
 * ─── Why the challenge is created on SUBMIT, not on render ─────────────────
 *
 * The cart starts its challenge inside `sendOrder`, because a tap on Send is a
 * deliberate attempt. A page has no such moment — and `/stay` is reached from a
 * `<Link>` on the room home, which Next prefetches as soon as it is in the
 * viewport. Starting the challenge while rendering would therefore mint an
 * `access_escalations` row and a `verification_challenges` row for every guest
 * who merely scrolled past the row without tapping it.
 *
 * Both are load-bearing counters. Abandonment rate is how D-012 says a property
 * finds out its `escalation_trigger` is set too aggressively, and
 * `verification_challenges` counts failed attempts PER ROOM towards a lockout.
 * Prefetch would poison the first and spend the second.
 *
 * So the page renders the field with nothing behind it, and the first submit
 * starts the escalation and answers it in one call. Subsequent attempts carry
 * the ids back so the same challenge is re-used and the attempt count means
 * something.
 */

export interface FolioVerifyState {
  error?: string;
  /** Carried back so a second attempt lands on the SAME challenge. */
  challengeId?: string;
  escalationId?: string;
  attemptsLeft?: number;
}

const Verify = z.object({
  qrCode: z.string().min(1).max(64),
  answer: z.string().trim().min(1).max(8),
  challengeId: z.uuid().optional(),
  escalationId: z.uuid().optional(),
});

export async function verifyForFolio(
  _previous: FolioVerifyState,
  formData: FormData,
): Promise<FolioVerifyState> {
  const parsed = Verify.safeParse({
    qrCode: formData.get('qrCode'),
    answer: formData.get('answer'),
    challengeId: formData.get('challengeId') || undefined,
    escalationId: formData.get('escalationId') || undefined,
  });
  if (!parsed.success) {
    return { error: 'Enter the last four digits of the phone number on your booking.' };
  }

  const store = await cookies();
  const session = await resolveStaySession(store.get(GUEST_SESSION_COOKIE)?.value);
  if (!session) {
    return { error: 'This link has expired. Scan the code on your nightstand again.' };
  }

  try {
    /**
     * Already through — a guest who verified in another tab, or who ordered
     * dinner while this form was open. Nothing to answer; the page re-renders
     * as the bill.
     */
    const check = await requireTier(session, 'view_folio');
    if (!check.required) {
      revalidatePath(`/r/${parsed.data.qrCode}/stay`);
      return {};
    }

    // First submit mints both; later ones re-use what came back, so the attempt
    // count on the challenge is the guest's real attempt count.
    const escalationId = parsed.data.escalationId ?? check.escalationId;
    const challengeId = parsed.data.challengeId ?? await startPhoneLast4Challenge(session);

    const result = await answerChallenge(session, challengeId, parsed.data.answer, escalationId);

    if (!result.ok) {
      return {
        challengeId,
        escalationId,
        attemptsLeft: result.attemptsLeft,
        error: result.attemptsLeft === 1
          ? 'That does not match. One more attempt before this room is locked for 30 minutes.'
          : 'That does not match the number on your booking. Try again.',
      };
    }

    logger.info(
      { escalationId, from: check.fromTier, to: result.newTier },
      'folio escalation succeeded',
    );

    // The page is a Server Component reading the session's tier. Revalidate and
    // it renders the bill instead of this form.
    revalidatePath(`/r/${parsed.data.qrCode}/stay`);
    return {};
  } catch (error) {
    if (error instanceof AppError) {
      // Keep the ids so a lockout message is not sitting under a form that has
      // forgotten which challenge it belonged to.
      return {
        error: publicPayloadFor(error).message,
        challengeId: parsed.data.challengeId,
        escalationId: parsed.data.escalationId,
      };
    }
    if (error instanceof UnauthenticatedError) {
      return { error: 'This link has expired. Scan the code on your nightstand again.' };
    }
    logger.error({ err: (error as Error).message }, 'folio verification failed');
    throw error;
  }
}

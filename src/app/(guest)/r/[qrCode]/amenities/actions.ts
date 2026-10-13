'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { withTenant } from '@/db';
import {
  resolveStaySession, GUEST_SESSION_COOKIE, requireTier, startPhoneLast4Challenge,
  answerChallenge,
} from '@/modules/access';
import { raiseServiceRequest, getRequestCatalog } from '@/modules/requests';
import { AppError, publicPayloadFor } from '@/lib/errors';
import { formatMoney, money } from '@/lib/money';
import { logger } from '@/lib/logger';

/**
 * Sending what the guest asked for.
 *
 * Two things this shares with the cart's send, deliberately and for the same
 * reasons: the idempotency key is minted when the SCREEN renders so both taps of
 * a double-tap carry one key (#8), and the one verification prompt appears HERE,
 * at the first attempt to charge — not at the scan (D-012).
 *
 * The difference is that most of this screen is free. A guest asking for towels
 * never sees a prompt, because `requireTier` is only consulted when the total is
 * above zero.
 */

export interface RequestActionState {
  error?: string;
  /** Present when the guest must answer the one question before this can go. */
  escalation?: {
    challengeId: string;
    escalationId: string;
    idempotencyKey: string;
    /** Echoed back so the prompt can say what it is for. */
    payload: string;
    total: string;
  };
}

/** `qty-<uuid>` fields, so the whole screen posts as one form without JS. */
const Send = z.object({
  qrCode: z.string().min(1),
  idempotencyKey: z.uuid(),
  guestNote: z.string().trim().max(400).optional().transform((v) => (v ? v : null)),
});

interface Chosen {
  requestTypeId: string;
  quantity: number;
}

function readChosen(formData: FormData): Chosen[] {
  const chosen: Chosen[] = [];

  for (const [field, value] of formData.entries()) {
    if (!field.startsWith('qty-')) continue;
    const quantity = Number(String(value));
    // Zero is how the stepper says "not this one" — an absent field and a zero
    // mean the same thing, and the form posts every row.
    if (!Number.isInteger(quantity) || quantity < 1) continue;
    chosen.push({ requestTypeId: field.slice(4), quantity });
  }

  return chosen;
}

export async function sendRequests(
  _previous: RequestActionState,
  formData: FormData,
): Promise<RequestActionState> {
  const parsed = Send.safeParse({
    qrCode: formData.get('qrCode'),
    idempotencyKey: formData.get('idempotencyKey'),
    guestNote: formData.get('guestNote') ?? undefined,
  });
  if (!parsed.success) return { error: 'That did not come through. Try again.' };

  const chosen = readChosen(formData);
  if (!chosen.length) return { error: 'Choose something first.' };

  return sendOrEscalate({
    qrCode: parsed.data.qrCode,
    idempotencyKey: parsed.data.idempotencyKey,
    guestNote: parsed.data.guestNote,
    lines: chosen,
  });
}

/**
 * The shared path: try to send, and if the tier is short, start the one prompt
 * instead of refusing.
 *
 * Exported because the service screen sends exactly one line and needs the same
 * behaviour without duplicating the escalation dance.
 */
export async function sendOrEscalate(input: {
  qrCode: string;
  idempotencyKey: string;
  guestNote?: string | null;
  photoUrl?: string | null;
  lines: readonly Chosen[];
}): Promise<RequestActionState> {
  const store = await cookies();
  const session = await resolveStaySession(store.get(GUEST_SESSION_COOKIE)?.value);
  if (!session) redirect(`/r/${encodeURIComponent(input.qrCode)}`);

  try {
    /**
     * What is this going to cost? Read the catalog first, because the answer
     * decides whether the guest is asked anything at all (#9).
     */
    const total = await withTenant(
      { tenantId: session.tenantId, propertyId: session.propertyId },
      async (tx) => {
        const catalog = await getRequestCatalog(tx, { propertyId: session.propertyId });
        const byId = new Map(catalog.map((c) => [c.id, c]));
        return input.lines.reduce(
          (sum, line) => sum + (byId.get(line.requestTypeId)?.priceMinor ?? 0) * line.quantity,
          0,
        );
      },
    );

    if (total > 0) {
      // D-012: escalate, do not 403. The guest is mid-action and the action is
      // completed for them once they answer. `chargeable_request` is the action
      // name the tier table already has for exactly this (tiers.ts).
      const check = await requireTier(session, 'chargeable_request');
      if (check.required) {
        const challengeId = await startPhoneLast4Challenge(session);
        logger.info(
          { escalationId: check.escalationId, from: check.fromTier, to: check.toTier },
          'escalation prompted for a chargeable request',
        );
        return {
          escalation: {
            challengeId,
            escalationId: check.escalationId,
            idempotencyKey: input.idempotencyKey,
            payload: JSON.stringify(input.lines),
            total: formatMoney(money(total, 'INR')),
          },
        };
      }
    }

    const raised = await withTenant(
      { tenantId: session.tenantId, propertyId: session.propertyId },
      (tx) => raiseServiceRequest(tx, {
        tenantId: session.tenantId,
        propertyId: session.propertyId,
        stayId: session.stayId,
        roomId: session.roomId,
        lines: input.lines,
        guestNote: input.guestNote,
        photoUrl: input.photoUrl,
        idempotencyKey: input.idempotencyKey,
        accessTier: session.accessTier,
        guestSessionId: session.id,
      }),
    );

    logger.info(
      { requestNumber: raised.requestNumber, totalMinor: raised.totalMinor },
      'service request raised',
    );

    redirect(`/r/${encodeURIComponent(input.qrCode)}/service/${raised.requestId}`);
  } catch (error) {
    // `redirect()` throws by design; letting it through is how it works.
    if (error instanceof Error && error.message === 'NEXT_REDIRECT') throw error;
    if ((error as { digest?: string }).digest?.startsWith('NEXT_REDIRECT')) throw error;

    if (error instanceof AppError) {
      logger.info({ code: error.code }, 'request refused');
      return { error: publicPayloadFor(error).message };
    }
    logger.error({ err: (error as Error).message }, 'request failed');
    throw error;
  }
}

const Verify = z.object({
  qrCode: z.string().min(1),
  challengeId: z.uuid(),
  escalationId: z.uuid(),
  idempotencyKey: z.uuid(),
  payload: z.string(),
  answer: z.string().trim().min(1, 'Enter the last four digits.'),
  guestNote: z.string().trim().max(400).optional().transform((v) => (v ? v : null)),
});

/**
 * Answer the one question, and complete what the guest was already doing.
 *
 * The same rule as the cart: verifying finishes the ORIGINAL action. A guest who
 * answers and is then returned to a screen to press send again has been asked
 * to do the same thing twice.
 */
export async function verifyAndSend(
  _previous: RequestActionState,
  formData: FormData,
): Promise<RequestActionState> {
  const parsed = Verify.safeParse({
    qrCode: formData.get('qrCode'),
    challengeId: formData.get('challengeId'),
    escalationId: formData.get('escalationId'),
    idempotencyKey: formData.get('idempotencyKey'),
    payload: formData.get('payload'),
    answer: formData.get('answer') ?? '',
    guestNote: formData.get('guestNote') ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Enter the last four digits.' };
  }

  const store = await cookies();
  const session = await resolveStaySession(store.get(GUEST_SESSION_COOKIE)?.value);
  if (!session) redirect(`/r/${encodeURIComponent(parsed.data.qrCode)}`);

  let lines: Chosen[];
  try {
    lines = z.array(z.object({ requestTypeId: z.uuid(), quantity: z.number().int().min(1) }))
      .parse(JSON.parse(parsed.data.payload));
  } catch {
    return { error: 'That did not come through. Start again.' };
  }

  const again = {
    escalation: {
      challengeId: parsed.data.challengeId,
      escalationId: parsed.data.escalationId,
      idempotencyKey: parsed.data.idempotencyKey,
      payload: parsed.data.payload,
      total: '',
    },
  };

  try {
    const result = await answerChallenge(
      session,
      parsed.data.challengeId,
      parsed.data.answer,
      parsed.data.escalationId,
    );

    if (!result.ok) {
      return {
        ...again,
        error: result.attemptsLeft === 1
          ? 'That does not match. One more try.'
          : `That does not match. ${result.attemptsLeft ?? 0} tries left.`,
      };
    }
  } catch (error) {
    if (error instanceof AppError) return { ...again, error: publicPayloadFor(error).message };
    throw error;
  }

  // The tier is raised on the EXISTING session, so re-reading it is what makes
  // the send below succeed.
  return sendOrEscalate({
    qrCode: parsed.data.qrCode,
    idempotencyKey: parsed.data.idempotencyKey,
    guestNote: parsed.data.guestNote,
    lines,
  });
}

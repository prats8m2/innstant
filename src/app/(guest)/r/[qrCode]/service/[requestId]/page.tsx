import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, Clock, Phone } from 'lucide-react';
import { withTenant } from '@/db';
import { resolveStaySession, GUEST_SESSION_COOKIE } from '@/modules/access';
import { getRequestForStay, type RequestStatus } from '@/modules/requests';
import { getPropertyProfile, dialable } from '@/modules/identity';
import { formatMoney, money } from '@/lib/money';
import { CancelRequest } from './cancel-form';
import { LiveRequest } from './live-request';
import styles from './request.module.css';

/**
 * "Someone is coming up."
 *
 * Where a request lands, whether it came from the one tap or from the amenities
 * list. There is no board for it; it speaks the order-tracking board's
 * language (Direction A's `GuestTracking`) — a sentence set large, the promise
 * in mono, a four-step timeline on a rail, and the thing asked for in a card at
 * the foot — so a guest who has tracked dinner already knows how to read it.
 *
 * Live updates arrive the same way the order timeline's do — through SSE on the
 * request channel. No `loading.tsx` beside this file, on purpose (D-099).
 *
 * Until a request is assigned there is no name to show, so this says what is
 * true instead of inventing one. Only two moments carry a time: when it was
 * asked for (`created_at`) and when it was done (`completed_at`). The steps in
 * between have no stamp on the row, so they show none rather than a guess.
 */
export const dynamic = 'force-dynamic';

type StepState = 'done' | 'active' | 'pending';

/** Where each status stands on the four steps. */
const POSITION: Record<RequestStatus, number> = {
  OPEN: 0,
  ASSIGNED: 1,
  IN_PROGRESS: 2,
  COMPLETED: 3,
  VERIFIED: 3,
  // Halted — the screen shows a sentence, not the timeline.
  REJECTED: -1,
  CANCELLED: -1,
};

export default async function RequestScreen({
  params,
}: {
  params: Promise<{ qrCode: string; requestId: string }>;
}) {
  const { qrCode, requestId } = await params;
  const store = await cookies();
  const session = await resolveStaySession(store.get(GUEST_SESSION_COOKIE)?.value);

  if (!session) redirect(`/r/${encodeURIComponent(qrCode)}`);

  const { request, profile } = await withTenant(
    { tenantId: session.tenantId, propertyId: session.propertyId },
    async (tx) => ({
      // Scoped by stay: a request id in a URL must not resolve to the room next
      // door's leaking tap.
      request: await getRequestForStay(tx, { stayId: session.stayId, requestId }),
      profile: await getPropertyProfile(tx, session.propertyId),
    }),
  );

  if (!request) notFound();

  const base = `/r/${encodeURIComponent(qrCode)}`;
  // The PROPERTY's timezone, never the server's (CLAUDE.md "Dates").
  const timeZone = profile?.timezone ?? 'Asia/Kolkata';
  const clock = new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone,
  });
  const at = (value: Date | null) =>
    (value ? clock.format(value).replace(/\s?([ap])\.?m\.?/i, (_, p: string) => `${p.toLowerCase()}m`) : '');
  const phone = profile?.guestInfo.contactPhone ? dialable(profile.guestInfo.contactPhone).tel : null;

  /**
   * What the guest is told, from the status.
   *
   * A name only when there is one — `assigned_staff_name` is null until routing
   * assigns it, and "Ravi is on his way" with no Ravi is the kind of invented
   * detail that makes a guest stop trusting the screen.
   */
  const who = request.assignedStaffName;
  const headline = {
    OPEN: 'Asked for. Someone is coming up.',
    ASSIGNED: who ? `${who} is on the way` : 'Someone is on the way',
    IN_PROGRESS: who ? `${who} is on the way` : 'On the way now',
    COMPLETED: 'Done',
    VERIFIED: 'Done',
    REJECTED: 'We could not do this',
    CANCELLED: 'Cancelled',
  }[request.status];

  const live = ['OPEN', 'ASSIGNED', 'IN_PROGRESS'].includes(request.status);

  /** The two ends that credit the room back rather than delivering anything. */
  const reversed = request.status === 'REJECTED' || request.status === 'CANCELLED';

  // The promise, from the row's own countdown — a breach is a function of the
  // clock, computed by the read and never stored.
  const late = live && request.breached && request.secondsRemaining !== null;
  const behindMinutes = late ? Math.max(1, Math.round(Math.abs(request.secondsRemaining!) / 60)) : 0;
  const minutesLeft = live && !late && request.secondsRemaining !== null
    ? Math.round(request.secondsRemaining / 60)
    : null;
  const by = request.slaTargetAt ? splitMeridiem(at(request.slaTargetAt)) : null;

  const position = POSITION[request.status];
  const steps: { key: string; title: string; sub: string; time: string; state: StepState }[] = [
    {
      key: 'ASKED',
      title: 'Asked for',
      sub: 'The desk has it.',
      time: at(request.createdAt),
    },
    {
      key: 'TAKEN',
      title: 'Taken by the team',
      sub: who ? `${who} has it.` : 'Passed to whoever is nearest.',
      time: '',
    },
    {
      key: 'COMING',
      title: 'Coming up',
      sub: `Brought to room ${session.roomNumber}.`,
      time: '',
    },
    {
      // Not "Done": that is the headline's word once it is, and the e2e
      // suite reads it as the one element saying so.
      key: 'DONE',
      title: 'Finished',
      sub: 'Nothing else to do.',
      time: at(request.completedAt),
    },
  ].map((step, i) => ({
    ...step,
    state: i < position ? 'done' : i === position ? 'active' : 'pending',
  }));
  const activeStep = steps.find((step) => step.state === 'active');

  return (
    <main className={styles.shell}>
      <header className={styles.bar}>
        {/* To the LIST, not the room home — back from one request is "my
            requests" (D-058). The room home is one tap on from there. */}
        <Link href={`${base}/activity`} className={styles.back} aria-label="Back to your requests">
          <ChevronLeft size={22} strokeWidth={1.5} aria-hidden="true" />
        </Link>
        <h1 className={styles.barTitle}>
          Room <span className="tabular">{session.roomNumber}</span>
          <span aria-hidden="true"> · </span>
          <span className="tabular">{request.requestNumber}</span>
        </h1>
        <span className={styles.barEnd} aria-hidden="true" />
      </header>

      <section className={styles.hero} role="status">
        {late ? (
          <p className={styles.behind}>
            <Clock size={16} strokeWidth={1.5} aria-hidden="true" />
            About <span className="tabular">{behindMinutes}</span>{' '}
            {behindMinutes === 1 ? 'minute' : 'minutes'} behind
          </p>
        ) : null}

        <h2 className={styles.headline}>{headline}</h2>

        {live && by && !late ? (
          <p className={styles.promise}>
            <span className={`${styles.promiseTime} tabular`}>{by.time}</span>
            <span className={styles.promiseNote}>
              {by.meridiem} at the latest
              {minutesLeft !== null && minutesLeft > 0 ? (
                <> · about <span className="tabular">{minutesLeft}</span> min</>
              ) : null}
            </span>
          </p>
        ) : null}

        {late && by ? (
          <p className={styles.heroNote}>
            We said <s className="tabular">{by.time}{by.meridiem}</s>. It is still coming
            {phone ? ' — the desk can tell you where it is' : ''}.
          </p>
        ) : null}

        {request.status === 'COMPLETED' || request.status === 'VERIFIED' ? (
          request.completedAt ? (
            <p className={styles.heroNote}>
              Finished at <span className="tabular">{at(request.completedAt)}</span>.
            </p>
          ) : null
        ) : null}

        {request.rejectionReason ? (
          <p className={styles.reason}>“{request.rejectionReason}”</p>
        ) : null}

        {request.status === 'CANCELLED' ? (
          <p className={styles.heroNote}>Nobody is coming up for this one.</p>
        ) : request.status === 'REJECTED' ? (
          <p className={styles.heroNote}>
            {phone ? 'The desk can tell you more, or ask for something else.' : 'Ask for something else, or ask at the desk.'}
          </p>
        ) : null}
      </section>

      {position >= 0 ? (
        <>
          <p className="sr-only">Now: {activeStep?.title}</p>
          <ol className={styles.steps} data-late={late}>
            {steps.map((step, i) => {
              const when = step.state === 'active' && live
                ? (late ? 'late' : 'now')
                : step.state === 'pending'
                  ? (i === steps.length - 1 && by && !late ? `~${by.time}` : '')
                  : step.time;
              return (
                <li key={step.key} className={styles.step} data-state={step.state}>
                  <span className={styles.dot} aria-hidden="true" />
                  <span className={styles.stepBody}>
                    <span className={styles.stepTitle}>{step.title}</span>
                    <span className={styles.stepSub}>{step.sub}</span>
                  </span>
                  <span className={`${styles.stepTime} tabular`}>{when}</span>
                </li>
              );
            })}
          </ol>
        </>
      ) : null}

      <LiveRequest requestId={request.id} live={live} />

      <div className={styles.foot} data-pinned={position >= 0}>
        <section className={styles.card} aria-label="What you asked for">
          <ul className={styles.asked}>
            {request.lines.map((line, i) => (
              <li key={`${request.id}-${i}`} className={styles.askedLine}>
                <span className={`${styles.askedQty} tabular`}>{line.quantity}×</span>
                <span className={styles.askedLabel}>{line.label}</span>
                {line.lineTotalMinor > 0 ? (
                  <span className={`${styles.askedPrice} tabular`}>
                    {formatMoney(money(line.lineTotalMinor, request.currency))}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>

          {request.guestNote ? <p className={styles.echo}>“{request.guestNote}”</p> : null}

          {/*
            * The money line, and it has to follow the reversal.
            *
            * `raiseServiceRequest()` posts at placement, so "on room 214" is true
            * the moment the guest asks. REJECTED and CANCELLED credit it back in
            * the same transaction as the status change (`advanceRequest`, D-027's
            * reasoning applied to requests) — so this screen said "₹450 is on room
            * 214" under the word "Cancelled" for as long as that reversal was
            * missing, and would say it again if the reversal were removed.
            *
            * Like the order timeline's equivalent, this promises a NET of zero
            * rather than the existence of a credit row: a free request has nothing
            * to credit and the sentence is still true.
            */}
          {request.totalMinor > 0 ? (
            reversed ? (
              <p className={styles.folioNote}>
                Nothing has been charged for it —{' '}
                <span className="tabular">{formatMoney(money(request.totalMinor, request.currency))}</span>
                {' '}came back off room {session.roomNumber}.
              </p>
            ) : (
              <p className={styles.folioNote}>
                <span className="tabular">{formatMoney(money(request.totalMinor, request.currency))}</span>
                {' '}is on room {session.roomNumber}, settled at checkout.
              </p>
            )
          ) : (
            <p className={styles.folioNote}>Nothing to pay.</p>
          )}
        </section>

        {live ? <CancelRequest qrCode={qrCode} requestId={request.id} /> : null}

        <nav className={styles.actions} aria-label="Next">
          {phone ? (
            <a href={`tel:${phone}`} className={styles.action}>
              <Phone size={18} strokeWidth={1.5} aria-hidden="true" />
              Call the desk
            </a>
          ) : null}
          <Link href={`${base}/amenities`} className={`${styles.action} ${styles.actionQuiet}`}>
            Ask for something else
          </Link>
        </nav>
      </div>
    </main>
  );
}

function splitMeridiem(value: string): { time: string; meridiem: string } {
  const m = /^(.*?)([ap]m)$/.exec(value);
  return m ? { time: m[1]!, meridiem: m[2]! } : { time: value, meridiem: '' };
}

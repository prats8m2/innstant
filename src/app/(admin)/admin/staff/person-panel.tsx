'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  BedDouble, ClipboardList, Clock, Settings2, ShieldCheck, Users, UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import type { ActivityLine } from '@/lib/activity';
import {
  inviteStaffMember, reissueInviteLink, editStaffMember, setStaffActive, changeRole,
  clockOutStaff, type StaffState,
} from './actions';
import { Avatar, StatusBadge, type RoleOption, type StaffView } from './staff-board';
import styles from '../admin.module.css';
import s from './staff.module.css';

export interface ActivityView {
  id: string;
  text: string;
  kind: ActivityLine['kind'];
  /** "today 10:40" or "14 Mar". */
  when: string;
}

export interface PanelPermissions {
  invite: boolean;
  update: boolean;
  deactivate: boolean;
  assignRole: boolean;
  manageShifts: boolean;
}

const KIND_ICON: Record<ActivityView['kind'], LucideIcon> = {
  order: UtensilsCrossed,
  request: ClipboardList,
  menu: UtensilsCrossed,
  stay: BedDouble,
  staff: Users,
  shift: Clock,
  setup: Settings2,
};

/**
 * Everything you can do to one person, in the order a manager reaches for it
 * (D-088): who they are, what they may do, whether they are working, what
 * they did — and switching them off, last and apart.
 */
export function PersonPanel({
  propertyId,
  person,
  roles,
  permissions,
  activity,
}: {
  propertyId: string;
  person: StaffView;
  roles: RoleOption[];
  permissions: PanelPermissions;
  activity: ActivityView[];
}) {
  const off = person.status === 'DISABLED';

  return (
    <div className={s.panel} data-staff-panel={person.email}>
      <div className={s.panelHero}>
        <Avatar name={person.fullName} muted={off} large />
        <div className={s.panelHeroText}>
          <StatusBadge status={person.status} />
          {person.onShift ? (
            <span className={s.onShift}>
              <span className={s.liveDot} aria-hidden="true" />
              On shift since {person.onShift.since ?? '—'}
            </span>
          ) : null}
          <span className={s.email}>
            {person.lastSeen ? `Last seen ${person.lastSeen}` : 'Never signed in'}
          </span>
        </div>
      </div>

      <PanelSection title="Details">
        {permissions.update && !off ? (
          <EditDetails propertyId={propertyId} person={person} />
        ) : (
          <dl className={s.facts}>
            <dt>Phone</dt><dd>{person.phone ?? '—'}</dd>
          </dl>
        )}
      </PanelSection>

      <PanelSection title="Roles here" hint="What they can see and do at this property.">
        <RoleList propertyId={propertyId} person={person} roles={roles} mayAssign={permissions.assignRole && !off} />
      </PanelSection>

      {person.onShift || permissions.manageShifts ? (
        <PanelSection title="Shift">
          {person.onShift ? (
            <>
              <p className={s.shiftLine}>
                Clocked in at <strong>{person.onShift.since ?? '—'}</strong>
                {person.onShift.floors.length ? <>, covering {person.onShift.floors.join(', ')}</> : null}.
              </p>
              {permissions.manageShifts ? <ClockOut propertyId={propertyId} person={person} /> : null}
            </>
          ) : (
            <p className={styles.hint}>Off shift. Nothing routes to them until they clock in on the floor app.</p>
          )}
        </PanelSection>
      ) : null}

      {permissions.invite && person.status !== 'ACTIVE' ? (
        <PanelSection title="Sign-in link">
          <Reissue propertyId={propertyId} person={person} />
        </PanelSection>
      ) : null}

      <PanelSection title="Recent activity" hint="What they did here, newest first. Sign-ins are left out.">
        {activity.length ? (
          <ol className={s.activity}>
            {activity.map((line) => {
              const Icon = KIND_ICON[line.kind];
              return (
                <li key={line.id} className={s.activityRow}>
                  <Icon className={s.activityIcon} size={16} strokeWidth={1.75} aria-hidden="true" />
                  <span className={s.activityText}>{line.text}</span>
                  <span className={`${s.activityWhen} tabular`}>{line.when}</span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className={styles.hint}>Nothing yet.</p>
        )}
      </PanelSection>

      {/* Never for yourself: switching off the account you are holding is the
          fastest way to lock a hotel out, and the person doing it is the one
          who then cannot undo it. The service refuses too. */}
      {permissions.deactivate && !person.isYou ? (
        <PanelSection title={off ? 'Switched off' : 'Switch off'} danger>
          <ActiveSwitch propertyId={propertyId} person={person} />
        </PanelSection>
      ) : null}
    </div>
  );
}

function PanelSection({
  title,
  hint,
  danger = false,
  children,
}: {
  title: string;
  hint?: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={s.panelSection} data-danger={danger}>
      <h3 className={s.panelTitle}>{title}</h3>
      {hint ? <p className={styles.hint}>{hint}</p> : null}
      {children}
    </section>
  );
}

function EditDetails({ propertyId, person }: { propertyId: string; person: StaffView }) {
  const [state, action] = useActionState<StaffState, FormData>(editStaffMember, {});
  return (
    <form action={action} className={s.panelForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="targetStaffId" value={person.id} />
      <label className={styles.field}>
        <span className={styles.label}>Name</span>
        <input name="fullName" defaultValue={person.fullName} className={styles.input} required maxLength={160} />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Phone</span>
        <input name="phone" defaultValue={person.phone ?? ''} className={styles.input} maxLength={32} type="tel" />
      </label>
      {/* The email is the login and is not editable: changing it is changing
          which account this is, and a typo would collide with a colleague. */}
      <p className={styles.hint}>The email is how they sign in and cannot be changed here.</p>
      <div className={s.formRow}>
        <SubmitButton label="Save details" primary />
        {state.error ? <span className={styles.inlineError} role="alert">{state.error}</span> : null}
        {state.done ? <span className={styles.inlineDone}>{state.done}</span> : null}
      </div>
    </form>
  );
}

/**
 * Every role at the property, held or not, each with its own button. One
 * list rather than "what they hold" plus an "add" dropdown: a manager asking
 * "can she do the desk as well?" reads the answer and the control on one line.
 */
function RoleList({
  propertyId,
  person,
  roles,
  mayAssign,
}: {
  propertyId: string;
  person: StaffView;
  roles: RoleOption[];
  mayAssign: boolean;
}) {
  const [state, action] = useActionState<StaffState, FormData>(changeRole, {});
  const held = roles.filter((role) => person.roleKeys.includes(role.key));
  // What they hold first, then what they could be given.
  const shown = mayAssign
    ? [...held, ...roles.filter((role) => !person.roleKeys.includes(role.key))]
    : held;

  return (
    <>
      {shown.length ? (
        <ul className={s.roleList}>
          {shown.map((role) => {
            const has = person.roleKeys.includes(role.key);
            return (
              <li key={role.key} className={s.roleRow} data-held={has}>
                <ShieldCheck className={s.roleIcon} size={16} aria-hidden="true" />
                <span className={s.roleRowName}>{role.name}</span>
                {mayAssign ? (
                  <form action={action}>
                    <input type="hidden" name="propertyId" value={propertyId} />
                    <input type="hidden" name="targetStaffId" value={person.id} />
                    <input type="hidden" name="roleKey" value={role.key} />
                    <input type="hidden" name="remove" value={String(has)} />
                    <SubmitButton label={has ? 'Take away' : 'Give'} />
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={styles.hint}>No role here. They can sign in and will see an empty console.</p>
      )}
      {state.error ? <p className={styles.inlineError} role="alert">{state.error}</p> : null}
      {state.done ? <p className={styles.inlineDone}>{state.done}</p> : null}
    </>
  );
}

function ClockOut({ propertyId, person }: { propertyId: string; person: StaffView }) {
  const [state, action] = useActionState<StaffState, FormData>(clockOutStaff, {});
  return (
    <form action={action} className={s.formRow}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="targetStaffId" value={person.id} />
      <SubmitButton
        label="Clock them out"
        title={`For when ${person.fullName} went home without clocking out — requests stop routing to them`}
      />
      {state.error ? <span className={styles.inlineError} role="alert">{state.error}</span> : null}
      {state.done ? <span className={styles.inlineDone}>{state.done}</span> : null}
    </form>
  );
}

function ActiveSwitch({ propertyId, person }: { propertyId: string; person: StaffView }) {
  const [state, action] = useActionState<StaffState, FormData>(setStaffActive, {});
  const off = person.status === 'DISABLED';

  return (
    <form action={action} className={s.panelForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="targetStaffId" value={person.id} />
      <input type="hidden" name="reactivate" value={String(off)} />
      <p className={styles.hint}>
        {off
          ? `${person.fullName} keeps their roles and history. Switching back on means a new link and a new password.`
          : `${person.fullName} stops being able to sign in, on every device, now. Their roles and history stay.`}
      </p>
      <div className={s.formRow}>
        <SubmitButton label={off ? 'Switch on' : 'Switch off'} danger={!off} />
        {state.error ? <span className={styles.inlineError} role="alert">{state.error}</span> : null}
        {state.done ? <span className={styles.inlineDone}>{state.done}</span> : null}
      </div>
      {/* Switching on clears the password (D-044), so the link is the way
          back in — made with the switch, and shown here once. */}
      {state.invite ? (
        <>
          <p className={styles.hint}>
            {state.invite.name} needs this link to set a new password. Their old one no longer works.
          </p>
          <InviteLink invite={state.invite} />
        </>
      ) : null}
    </form>
  );
}

function Reissue({ propertyId, person }: { propertyId: string; person: StaffView }) {
  const [state, action] = useActionState<StaffState, FormData>(reissueInviteLink, {});
  return (
    <form action={action} className={s.panelForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="targetStaffId" value={person.id} />
      <input type="hidden" name="fullName" value={person.fullName} />
      <p className={styles.hint}>
        {person.inviteLive
          ? 'Their link is live. Issuing another kills it — the link is stored hashed, so the old one cannot be shown again.'
          : 'They have no live link. This makes one.'}
      </p>
      {state.error ? <p className={styles.inlineError} role="alert">{state.error}</p> : null}
      {state.invite ? <InviteLink invite={state.invite} /> : null}
      <div className={s.formRow}>
        <SubmitButton label={person.inviteLive ? 'Issue a new link' : 'Make a link'} />
      </div>
    </form>
  );
}

export function InvitePanel({ propertyId, roles }: { propertyId: string; roles: RoleOption[] }) {
  const [state, action] = useActionState<StaffState, FormData>(inviteStaffMember, {});

  return (
    <form action={action} className={s.panelForm} data-invite-form>
      <input type="hidden" name="propertyId" value={propertyId} />
      <label className={styles.field}>
        <span className={styles.label}>Name</span>
        <input name="fullName" className={styles.input} required maxLength={160} placeholder="Anita Rao" />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Email</span>
        <input name="email" type="email" className={styles.input} required maxLength={320}
          placeholder="anita@thekesari.example" />
        {/* One account per email per TENANT (D-006). A colleague at a sister
            hotel is added here, not duplicated. */}
        <span className={styles.hint}>If they already work at another of your hotels, this adds them here.</span>
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Phone</span>
        <input name="phone" className={styles.input} maxLength={32} type="tel" />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Role</span>
        <select name="roleKey" className={styles.input} required defaultValue="FRONT_DESK">
          {roles.map((role) => (
            <option key={role.key} value={role.key}>{role.name}</option>
          ))}
        </select>
        <span className={styles.hint}>More can be given once they are in.</span>
      </label>

      {state.error ? <p className={styles.inlineError} role="alert">{state.error}</p> : null}
      {state.invite ? <InviteLink invite={state.invite} /> : null}

      <div className={s.formRow}>
        <SubmitButton label="Invite them" primary />
      </div>
    </form>
  );
}

function InviteLink({ invite }: { invite: { token: string; name: string } }) {
  const [origin, setOrigin] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => setOrigin(window.location.origin), []);

  const url = origin ? `${origin}/admin/invite/${invite.token}` : null;

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      field.current?.select();
    }
  }

  return (
    <div className={s.inviteLink} data-invite-link>
      <p className={styles.inlineDone}>
        {invite.name}&rsquo;s link. It works once, for three days, and is not shown again.
      </p>
      <input
        ref={field}
        readOnly
        value={url ?? ''}
        className={styles.guestLinkField}
        onFocus={(event) => event.currentTarget.select()}
        aria-label={`Invite link for ${invite.name}`}
      />
      {/* type="button" — inside a form whose submit would throw this link away. */}
      <button type="button" className={styles.secondary} onClick={copy} disabled={!url}>
        {copied ? 'Copied' : 'Copy the link'}
      </button>
    </div>
  );
}

function SubmitButton({
  label,
  title,
  primary = false,
  danger = false,
}: {
  label: string;
  title?: string;
  primary?: boolean;
  danger?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={primary ? styles.primary : danger ? styles.danger : styles.secondary}
      title={title}
      disabled={pending}
    >
      {pending ? '…' : label}
    </button>
  );
}

'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  inviteStaffMember, reissueInviteLink, editStaffMember, setStaffActive, changeRole,
  type StaffState,
} from './actions';
import styles from '../admin.module.css';

/**
 * The rota.
 *
 * Every mutation is a `<form action={...}>` posting to a Server Action, like
 * every other editor in this console — the screen works with JavaScript off, and
 * `useActionState` only adds the message and the pending state on top. The one
 * exception is the invite link, which needs the clipboard.
 */
export interface StaffView {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  status: string;
  lastSeen: string | null;
  roleKeys: string[];
  roleNames: string[];
  inviteLive: boolean;
  isYou: boolean;
}

export interface RoleOption {
  key: string;
  name: string;
  staffCount: number;
}

export interface StaffPermissions {
  invite: boolean;
  update: boolean;
  deactivate: boolean;
  assignRole: boolean;
}

export function StaffBoard({
  propertyId,
  staff,
  roles,
  permissions,
}: {
  propertyId: string;
  staff: StaffView[];
  roles: RoleOption[];
  permissions: StaffPermissions;
}) {
  const working = staff.filter((member) => member.status !== 'DISABLED');
  const off = staff.filter((member) => member.status === 'DISABLED');

  return (
    <>
      <section className={styles.section}>
        <header className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Working here</h2>
          <p className={styles.sectionBlurb}>
            A role is held AT this property. Somebody who manages three hotels is
            one account with three grants, not three logins.
          </p>
        </header>

        {working.length ? (
          <ul className={styles.dishes}>
            {working.map((member) => (
              <Member
                key={member.id}
                propertyId={propertyId}
                member={member}
                roles={roles}
                permissions={permissions}
              />
            ))}
          </ul>
        ) : (
          <p className={styles.sectionEmpty}>Nobody yet.</p>
        )}

        {permissions.invite ? <NewStaff propertyId={propertyId} roles={roles} /> : null}
      </section>

      {off.length ? (
        <section className={styles.section}>
          <header className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Switched off</h2>
            <p className={styles.sectionBlurb}>
              They keep their roles and their history. They cannot sign in.
            </p>
          </header>
          <ul className={styles.dishes}>
            {off.map((member) => (
              <Member
                key={member.id}
                propertyId={propertyId}
                member={member}
                roles={roles}
                permissions={permissions}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <section className={styles.section}>
        <header className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Roles</h2>
          <p className={styles.sectionBlurb}>
            Requests route to whoever holds a role here. A role nobody holds is a
            queue nobody is watching.
          </p>
        </header>
        {/* A reference table, not a list of things to act on: eight rows at
            row height was most of a screen to say "1 person" eight times. */}
        <ul className={styles.roleGrid}>
          {roles.map((role) => (
            <li key={role.key} className={styles.roleCell} data-role={role.key}>
              <span className={styles.roleName}>{role.name}</span>
              <span className={role.staffCount ? styles.roleCount : styles.roleNobody}>
                {role.staffCount
                  ? `${role.staffCount} ${role.staffCount === 1 ? 'person' : 'people'}`
                  : 'nobody'}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/* ── One person ─────────────────────────────────────────────────────────── */

function Member({
  propertyId,
  member,
  roles,
  permissions,
}: {
  propertyId: string;
  member: StaffView;
  roles: RoleOption[];
  permissions: StaffPermissions;
}) {
  return (
    <li
      className={`${styles.dish} ${styles.typeRow}`}
      data-muted={member.status === 'DISABLED'}
      data-staff={member.email}
    >
      <span className={styles.dishBody}>
        <span className={styles.dishName}>
          {member.fullName}
          {member.isYou ? <span className={styles.offTag} data-tone="neutral">you</span> : null}
          {member.status === 'INVITED' ? <span className={styles.offTag}>not signed in</span> : null}
          {member.status === 'DISABLED' ? <span className={styles.offTag} data-tone="critical">switched off</span> : null}
        </span>
        <span className={styles.dishFlags}>
          {member.email}
          {member.roleNames.length ? ` · ${member.roleNames.join(', ')}` : ' · no role here'}
          {member.lastSeen ? ` · last seen ${member.lastSeen}` : ' · never signed in'}
        </span>
      </span>

      {/* One cell, so four controls and two controls start at the same x down
          the list. As separate grid children they wrapped onto a second line the
          moment a row had three. */}
      <span className={styles.rowEnd}>
        {permissions.update && member.status !== 'DISABLED' ? (
          <EditMember propertyId={propertyId} member={member} />
        ) : null}

        {permissions.assignRole && member.status !== 'DISABLED' ? (
          <Roles propertyId={propertyId} member={member} roles={roles} />
        ) : null}

        {permissions.invite && member.status !== 'ACTIVE' ? (
          <Reissue propertyId={propertyId} member={member} />
        ) : null}

        {/* Never for yourself: switching off the account you are holding is the
            fastest way to lock a hotel out, and the person doing it is by
            definition the one who then cannot undo it. The service refuses too. */}
        {permissions.deactivate && !member.isYou ? (
          <ActiveSwitch propertyId={propertyId} member={member} />
        ) : null}
      </span>
    </li>
  );
}

function EditMember({ propertyId, member }: { propertyId: string; member: StaffView }) {
  const [state, action] = useActionState<StaffState, FormData>(editStaffMember, {});

  return (
    <details className={styles.roomForm}>
      <summary className={styles.disclosureHead}>Edit</summary>
      <form action={action} className={styles.stackedForm}>
        <input type="hidden" name="propertyId" value={propertyId} />
        <input type="hidden" name="targetStaffId" value={member.id} />
        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span className={styles.label}>Name</span>
            <input name="fullName" defaultValue={member.fullName} className={styles.input}
              required maxLength={160} />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Phone</span>
            <input name="phone" defaultValue={member.phone ?? ''} className={styles.input}
              maxLength={32} />
          </label>
        </div>
        {/* The email is the login and is deliberately not editable here: changing
            it is changing which account this is, and `staff_users_tenant_email_uq`
            would make a typo collide with a colleague. */}
        <p className={styles.hint}>
          The email is how they sign in and cannot be changed here.
        </p>
        {state.error ? <p className={styles.inlineError} role="alert">{state.error}</p> : null}
        {state.done ? <p className={styles.inlineDone}>{state.done}</p> : null}
        <SubmitButton label="Save" primary />
      </form>
    </details>
  );
}

function Roles({
  propertyId,
  member,
  roles,
}: {
  propertyId: string;
  member: StaffView;
  roles: RoleOption[];
}) {
  const [state, action] = useActionState<StaffState, FormData>(changeRole, {});
  const spare = roles.filter((role) => !member.roleKeys.includes(role.key));

  return (
    <details className={styles.roomForm}>
      <summary className={styles.disclosureHead}>Roles</summary>
      <div className={styles.stackedForm}>
        {member.roleKeys.length ? (
          <ul className={styles.dishes}>
            {member.roleKeys.map((key) => (
              <li key={key} className={styles.dish}>
                <span className={styles.dishBody}>
                  <span className={styles.dishName}>
                    {roles.find((role) => role.key === key)?.name ?? key}
                  </span>
                </span>
                <form action={action} className={styles.inlineForm}>
                  <input type="hidden" name="propertyId" value={propertyId} />
                  <input type="hidden" name="targetStaffId" value={member.id} />
                  <input type="hidden" name="roleKey" value={key} />
                  <input type="hidden" name="remove" value="true" />
                  <SubmitButton label="Take away" />
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.hint}>
            No role here. They can sign in and will see an empty console.
          </p>
        )}

        {spare.length ? (
          <form action={action} className={styles.inlineForm}>
            <input type="hidden" name="propertyId" value={propertyId} />
            <input type="hidden" name="targetStaffId" value={member.id} />
            <label className={styles.field}>
              <span className={styles.label}>Add a role</span>
              <select name="roleKey" className={styles.input} defaultValue={spare[0]!.key}>
                {spare.map((role) => (
                  <option key={role.key} value={role.key}>{role.name}</option>
                ))}
              </select>
            </label>
            <SubmitButton label="Add" primary />
          </form>
        ) : null}

        {state.error ? <p className={styles.inlineError} role="alert">{state.error}</p> : null}
        {state.done ? <p className={styles.inlineDone}>{state.done}</p> : null}
      </div>
    </details>
  );
}

function ActiveSwitch({ propertyId, member }: { propertyId: string; member: StaffView }) {
  const [state, action] = useActionState<StaffState, FormData>(setStaffActive, {});
  const off = member.status === 'DISABLED';

  return (
    <form action={action} className={styles.inlineForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="targetStaffId" value={member.id} />
      <input type="hidden" name="reactivate" value={String(off)} />
      <SubmitButton
        label={off ? 'Switch on' : 'Switch off'}
        title={
          off
            ? `${member.fullName} will need a new link and a new password`
            : `${member.fullName} stops being able to sign in, on every device, now`
        }
      />
      {state.error ? <span className={styles.inlineError} role="alert">{state.error}</span> : null}
      {state.done ? <span className={styles.inlineDone}>{state.done}</span> : null}
    </form>
  );
}

function Reissue({ propertyId, member }: { propertyId: string; member: StaffView }) {
  const [state, action] = useActionState<StaffState, FormData>(reissueInviteLink, {});

  return (
    <details className={styles.roomForm}>
      <summary className={styles.disclosureHead}>
        {member.inviteLive ? 'Link' : 'Send a link'}
      </summary>
      <form action={action} className={styles.stackedForm}>
        <input type="hidden" name="propertyId" value={propertyId} />
        <input type="hidden" name="targetStaffId" value={member.id} />
        <input type="hidden" name="fullName" value={member.fullName} />

        <p className={styles.hint}>
          {member.inviteLive
            ? 'Their link is live. Issuing another kills it — the link is stored hashed, so the old one cannot be shown again.'
            : 'They have no live link. This makes one.'}
        </p>

        {state.error ? <p className={styles.inlineError} role="alert">{state.error}</p> : null}
        {state.invite ? <InviteLink invite={state.invite} /> : null}

        <SubmitButton label={member.inviteLive ? 'Issue a new link' : 'Make a link'} />
      </form>
    </details>
  );
}

function NewStaff({ propertyId, roles }: { propertyId: string; roles: RoleOption[] }) {
  const [state, action] = useActionState<StaffState, FormData>(inviteStaffMember, {});

  return (
    <details className={styles.newSection}>
      <summary className={styles.disclosureHead}>Add somebody</summary>
      <form action={action} className={styles.stackedForm}>
        <input type="hidden" name="propertyId" value={propertyId} />
        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span className={styles.label}>Name</span>
            <input name="fullName" className={styles.input} required maxLength={160}
              placeholder="Anita Rao" />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Email</span>
            <input name="email" type="email" className={styles.input} required maxLength={320}
              placeholder="anita@thekesari.example" />
            {/* One account per email per TENANT (D-006). A colleague who already
                works at a sister hotel is added here, not duplicated. */}
            <span className={styles.hint}>
              If they already work at another of your hotels, this adds them here.
            </span>
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Phone</span>
            <input name="phone" className={styles.input} maxLength={32} />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Role</span>
            <select name="roleKey" className={styles.input} required defaultValue="FRONT_DESK">
              {roles.map((role) => (
                <option key={role.key} value={role.key}>{role.name}</option>
              ))}
            </select>
          </label>
        </div>

        {state.error ? <p className={styles.inlineError} role="alert">{state.error}</p> : null}
        {state.done ? <p className={styles.inlineDone}>{state.done}</p> : null}
        {state.invite ? <InviteLink invite={state.invite} /> : null}

        <SubmitButton label="Invite them" primary />
      </form>
    </details>
  );
}

/**
 * The link, shown once.
 *
 * Only the SHA-256 of the token is stored (#10), so this render is the only
 * moment it exists anywhere a person can reach — which is why it comes back in
 * the action's own result rather than being fetched by anything. Losing it means
 * issuing another, and the copy here is honest about that.
 *
 * There is no mail provider in this product, and adding one is a decision rather
 * than a session. So the manager copies this and hands it over — the same shape
 * as the guest link on the room list, and exactly what a mail provider would
 * send if there were one.
 */
function InviteLink({ invite }: { invite: { token: string; name: string } }) {
  const [origin, setOrigin] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  // After mount only: `window` does not exist on the server, and a different
  // first client paint is a hydration mismatch.
  useEffect(() => setOrigin(window.location.origin), []);

  const url = origin ? `${origin}/admin/invite/${invite.token}` : null;

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // A hotel on plain http over the LAN has no secure context and the
      // clipboard call rejects. Select the field instead of failing silently.
      field.current?.select();
    }
  }

  return (
    <div className={styles.stackedForm} data-invite-link>
      <p className={styles.inlineDone}>
        {invite.name}&rsquo;s link. It works once, for three days, and is not
        shown again.
      </p>
      <input
        ref={field}
        readOnly
        value={url ?? ''}
        className={styles.guestLinkField}
        onFocus={(event) => event.currentTarget.select()}
        aria-label={`Invite link for ${invite.name}`}
      />
      {/* type="button" — inside a form whose submit re-runs the action and would
          throw this link away. */}
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
}: {
  label: string;
  title?: string;
  primary?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={primary ? styles.primary : styles.secondary}
      title={title}
      disabled={pending}
    >
      {pending ? '…' : label}
    </button>
  );
}

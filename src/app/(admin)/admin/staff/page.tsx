import Link from 'next/link';
import { UserPlus } from 'lucide-react';
import { withTenant, readStaffActivity } from '@/db';
import { adminAccess, AdminDenied } from '../guard';
import {
  can, findProperty, listStaffAtProperty, listRolesAtProperty,
} from '@/modules/identity';
import { listOnShift } from '@/modules/housekeeping';
import { formatFolioDate } from '@/lib/clock';
import { describeActivity } from '@/lib/activity';
import { SidePanel } from '../side-panel';
import { StaffDirectory, type StaffView, type RoleOption } from './staff-board';
import { PersonPanel, InvitePanel, type ActivityView } from './person-panel';
import styles from '../admin.module.css';
import s from './staff.module.css';

/**
 * Who works here, what they may do, who is on right now, and what they did.
 *
 * ─── D-088: a directory and a panel, not a list of buttons ─────────────────
 *
 * Every row used to carry Edit, Roles and Switch off, each opening a form
 * under the row — three controls times every person, and nothing about
 * whether they were working. Now the list is a directory a manager reads
 * (who, what role, on shift since when, last seen) with a search and filters,
 * and everything you can DO to a person is in a panel that opens beside it
 * (`?person=<id>`, the same URL-driven SidePanel as the menu's dish editor):
 * their details, their roles, their shift, their recent work, and switching
 * them off at the bottom where it belongs.
 *
 * `provisionProperty()` has created exactly one PROPERTY_ADMIN as INVITED since
 * P0; this is the screen a pilot needs before any of the others matter.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function StaffAdmin({
  searchParams,
}: {
  searchParams: Promise<{ person?: string }>;
}) {
  // `staff:read` to look. Every control asks for its own permission again in the
  // action, and the ones this account lacks are not drawn.
  const access = await adminAccess('staff:read');
  if (!access.ok) return <AdminDenied reason={access.reason} />;
  const { session, propertyId } = access;

  const requested = (await searchParams).person;
  const personId = requested && UUID.test(requested) ? requested : null;
  const mayReadShifts = can(session, propertyId, 'shift:read');

  const { property, staff, roles, onShift, activity } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => ({
      property: await findProperty(tx, propertyId),
      staff: await listStaffAtProperty(tx, { propertyId }),
      roles: await listRolesAtProperty(tx, { propertyId }),
      onShift: mayReadShifts ? await listOnShift(tx, propertyId) : [],
      activity: personId
        ? await readStaffActivity(tx, { propertyId, staffUserId: personId, limit: 25 })
        : [],
    }),
  );

  const timeZone = property?.timezone ?? 'Asia/Kolkata';
  const time = (at: Date) => new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone,
  }).format(at);
  const day = (at: Date) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(at);
  const today = day(new Date());
  /** "today 10:40" or "14 Mar" — what a manager is asking, in the hotel's zone. */
  const when = (at: Date) => (day(at) === today ? `today ${time(at)}` : formatFolioDate(at, timeZone));

  const roleOptions: RoleOption[] = roles.map((role) => ({
    key: role.key,
    name: role.name,
    staffCount: role.staffCount,
  }));

  const views: StaffView[] = staff.map((member) => {
    const shift = onShift.find((entry) => entry.staffUserId === member.id);
    return {
      id: member.id,
      email: member.email,
      fullName: member.fullName,
      phone: member.phone,
      status: member.status,
      lastSeen: member.lastLoginAt ? when(member.lastLoginAt) : null,
      roleKeys: member.roleKeys,
      roleNames: member.roleKeys.map(
        (key) => roles.find((role) => role.key === key)?.name ?? key,
      ),
      inviteLive: member.inviteLive,
      isYou: member.id === session.staffUserId,
      onShift: shift
        ? {
          since: shift.clockedInAt ? time(shift.clockedInAt) : null,
          floors: shift.zones.map((zone) => zone.floorName),
        }
        : null,
    };
  });

  const active = views.filter((member) => member.status === 'ACTIVE').length;
  const waiting = views.filter((member) => member.status === 'INVITED').length;
  const working = views.filter((member) => member.onShift).length;
  /**
   * A role nobody holds is a queue nobody is watching:
   * `request_types.route_to_role_key` routes to whoever holds it, and with
   * nobody a request sits OPEN with a NOBODY_WITH_ROLE event nobody reads.
   * READ_ONLY is left out — nothing routes to it.
   */
  const unheld = roleOptions.filter((role) => !role.staffCount && role.key !== 'READ_ONLY');

  const permissions = {
    invite: can(session, propertyId, 'staff:invite'),
    update: can(session, propertyId, 'staff:update'),
    deactivate: can(session, propertyId, 'staff:deactivate'),
    assignRole: can(session, propertyId, 'role:assign'),
    manageShifts: can(session, propertyId, 'shift:manage'),
  };

  const person = personId ? views.find((member) => member.id === personId) ?? null : null;
  const activityViews: ActivityView[] = activity.flatMap((event, i) => {
    const line = describeActivity(event.eventType, event.payload);
    return line ? [{ id: `${i}`, text: line.text, kind: line.kind, when: when(event.occurredAt) }] : [];
  });

  return (
    <>
      <header className={styles.pageHead}>
        <div>
          <h1 className={styles.title}>Staff</h1>
          <p className={styles.lede}>
            {active} {active === 1 ? 'person' : 'people'} working here
            {mayReadShifts ? ` · ${working} on shift now` : ''}
            {waiting > 0 ? ` · ${waiting} not signed in yet` : ''}
          </p>
        </div>
        {permissions.invite ? (
          <Link href="/admin/staff?person=new" scroll={false} className={`${styles.primary} ${s.inviteButton}`}>
            <UserPlus size={16} strokeWidth={2} aria-hidden="true" />
            Invite someone
          </Link>
        ) : null}
      </header>

      <ul className={s.stats}>
        <li className={s.stat}>
          <span className={s.statLabel}>Working here</span>
          <span className={`${s.statValue} tabular`}>{active}</span>
          <span className={s.statSub}>{waiting ? `${waiting} not signed in yet` : 'everyone has signed in'}</span>
        </li>
        {mayReadShifts ? (
          <li className={s.stat} data-tone={working ? 'positive' : undefined}>
            <span className={s.statLabel}>On shift now</span>
            <span className={`${s.statValue} tabular`}>{working}</span>
            <span className={s.statSub}>
              {working ? views.filter((v) => v.onShift).map((v) => v.fullName.split(' ')[0]).join(', ') : 'nobody clocked in'}
            </span>
          </li>
        ) : null}
        <li className={s.stat} data-tone={unheld.length ? 'critical' : undefined}>
          <span className={s.statLabel}>Roles nobody holds</span>
          <span className={`${s.statValue} tabular`}>{unheld.length}</span>
          <span className={s.statSub}>
            {unheld.length
              ? `${unheld.map((role) => role.name).join(', ')} — requests for these wait for ever`
              : 'every queue has somebody'}
          </span>
        </li>
      </ul>

      <StaffDirectory staff={views} roles={roleOptions} showShifts={mayReadShifts} />

      <p className={styles.footnote}>
        An invite link sets a password and works once, for three days. It is
        stored hashed and never shown again — if it is lost, send another. A
        property is never left without an active property admin: the last one
        cannot be switched off, and cannot have the role taken away.
      </p>

      {requested === 'new' && permissions.invite ? (
        <SidePanel title="Invite someone" subtitle="They get a link to set their own password." closeHref="/admin/staff">
          <InvitePanel propertyId={propertyId} roles={roleOptions} />
        </SidePanel>
      ) : null}

      {person ? (
        <SidePanel title={person.fullName} subtitle={person.email} closeHref="/admin/staff">
          <PersonPanel
            propertyId={propertyId}
            person={person}
            roles={roleOptions}
            permissions={permissions}
            activity={activityViews}
          />
        </SidePanel>
      ) : null}
    </>
  );
}

'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Search } from 'lucide-react';
import styles from '../admin.module.css';
import s from './staff.module.css';

export interface StaffView {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  status: string;
  /** "today 10:40" or "14 Mar", in the property's zone. */
  lastSeen: string | null;
  roleKeys: string[];
  roleNames: string[];
  inviteLive: boolean;
  isYou: boolean;
  /** Clocked in right now, and where. Null when off shift or unknown. */
  onShift: { since: string | null; floors: string[] } | null;
}

export interface RoleOption {
  key: string;
  name: string;
  staffCount: number;
}

type StatusFilter = 'all' | 'shift' | 'active' | 'invited' | 'off';

const STATUS_FILTERS: ReadonlyArray<{ key: StatusFilter; label: string }> = [
  { key: 'all', label: 'Everyone' },
  { key: 'shift', label: 'On shift' },
  { key: 'active', label: 'Active' },
  { key: 'invited', label: 'Not signed in' },
  { key: 'off', label: 'Switched off' },
];

/**
 * The directory (D-088): read, search and filter; act in the panel.
 *
 * Filtering is local — a hotel has tens of staff, not thousands, and the
 * search answering on every keystroke is worth more than a URL for it. Which
 * person is OPEN is in the URL (`?person=`), so the panel survives a reload and
 * the back button closes it.
 */
export function StaffDirectory({
  staff,
  roles,
  showShifts,
}: {
  staff: StaffView[];
  roles: RoleOption[];
  showShifts: boolean;
}) {
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

  const filters = showShifts ? STATUS_FILTERS : STATUS_FILTERS.filter((f) => f.key !== 'shift');

  const count = (key: StatusFilter) => staff.filter((member) => matchesStatus(member, key)).length;

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return staff
      .filter((member) => matchesStatus(member, status))
      .filter((member) => !role || member.roleKeys.includes(role))
      .filter((member) => !needle
        || member.fullName.toLowerCase().includes(needle)
        || member.email.toLowerCase().includes(needle)
        || member.roleNames.some((name) => name.toLowerCase().includes(needle)))
      // Who is working first, then everyone else by name; switched off last.
      .sort((a, b) => rank(a) - rank(b) || a.fullName.localeCompare(b.fullName));
  }, [staff, query, role, status]);

  return (
    <section className={`${styles.section} ${s.directory}`} aria-label="Staff directory">
      <div className={s.toolbar}>
        <label className={s.search}>
          <Search size={16} aria-hidden="true" className={s.searchIcon} />
          <input
            type="search"
            className={s.searchInput}
            placeholder="Search by name, email or role"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search staff"
          />
        </label>
        <select
          className={s.roleFilter}
          value={role}
          onChange={(event) => setRole(event.target.value)}
          aria-label="Filter by role"
        >
          <option value="">All roles</option>
          {roles.map((option) => (
            <option key={option.key} value={option.key}>{option.name}</option>
          ))}
        </select>
        <div className={s.segments} role="group" aria-label="Filter by status">
          {filters.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className={s.segment}
              aria-pressed={status === filter.key}
              onClick={() => setStatus(filter.key)}
            >
              {filter.label}
              <span className={`${s.segmentCount} tabular`}>{count(filter.key)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={s.tableHead} aria-hidden="true">
        <span>Person</span>
        <span>Roles here</span>
        <span>Status</span>
        {showShifts ? <span>Shift</span> : <span />}
        <span>Last seen</span>
      </div>

      {shown.length ? (
        <ul className={s.rows}>
          {shown.map((member) => (
            <li key={member.id} data-staff={member.email} data-muted={member.status === 'DISABLED'}>
              <Link href={`/admin/staff?person=${member.id}`} scroll={false} className={s.row}>
                <span className={s.person}>
                  <Avatar name={member.fullName} muted={member.status === 'DISABLED'} />
                  <span className={s.personText}>
                    <span className={s.name}>
                      {member.fullName}
                      {member.isYou ? <span className={s.you}>you</span> : null}
                    </span>
                    <span className={s.email}>{member.email}</span>
                  </span>
                </span>
                <span className={s.roles}>
                  {member.roleNames.length
                    ? member.roleNames.map((name) => <span key={name} className={s.roleChip}>{name}</span>)
                    : <span className={s.noRole}>no role here</span>}
                </span>
                <span className={s.statusCell}>
                  <StatusBadge status={member.status} />
                </span>
                <span className={s.shiftCell}>
                  {member.onShift ? (
                    <span className={s.onShift}>
                      <span className={s.liveDot} aria-hidden="true" />
                      since {member.onShift.since ?? '—'}
                    </span>
                  ) : showShifts ? <span className={s.offShift}>off shift</span> : null}
                </span>
                <span className={s.lastSeen}>
                  {member.lastSeen ? `last seen ${member.lastSeen}` : 'never signed in'}
                </span>
                <ChevronRight className={s.chevron} size={18} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.sectionEmpty}>Nobody matches that. Clear the search or pick another filter.</p>
      )}
    </section>
  );
}

export function Avatar({ name, muted = false, large = false }: { name: string; muted?: boolean; large?: boolean }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join('');
  return (
    <span className={s.avatar} data-muted={muted} data-large={large} aria-hidden="true">
      {initials || '?'}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const label = status === 'ACTIVE' ? 'Active' : status === 'INVITED' ? 'not signed in' : 'switched off';
  const tone = status === 'ACTIVE' ? 'positive' : status === 'INVITED' ? 'attention' : 'critical';
  return <span className={s.badge} data-tone={tone}>{label}</span>;
}

function matchesStatus(member: StaffView, key: StatusFilter): boolean {
  switch (key) {
    case 'shift': return member.onShift != null;
    case 'active': return member.status === 'ACTIVE';
    case 'invited': return member.status === 'INVITED';
    case 'off': return member.status === 'DISABLED';
    default: return true;
  }
}

function rank(member: StaffView): number {
  if (member.status === 'DISABLED') return 3;
  if (member.onShift) return 0;
  if (member.status === 'INVITED') return 2;
  return 1;
}

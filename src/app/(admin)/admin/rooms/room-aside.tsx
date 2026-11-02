'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import r from './rooms.module.css';

/**
 * The room panel's frame (Direction A): docked beside the rack on a desk, so
 * the grid stays readable and clickable while a room is open, and a
 * full-screen sheet on a phone, where there is no "beside".
 *
 * Opened and closed by the URL (`?room=`), like every console view (D-061).
 * Escape closes it from anywhere on the page; the panel takes focus when it
 * opens, so a keyboard user lands in the room they chose. On a phone, the page
 * behind does not scroll under the sheet.
 */
export function RoomAside({
  label,
  closeHref,
  children,
}: {
  label: string;
  closeHref: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, [label]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // Escape in a half-typed field is not "close the room" — the rack's
      // search and the check-in form both keep their text.
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      router.push(closeHref, { scroll: false });
    };
    document.addEventListener('keydown', onKey);

    const sheet = window.matchMedia('(max-width: 1023px)');
    const root = document.documentElement;
    const previous = root.style.overflow;
    const lock = () => { root.style.overflow = sheet.matches ? 'hidden' : previous; };
    lock();
    sheet.addEventListener('change', lock);
    return () => {
      document.removeEventListener('keydown', onKey);
      sheet.removeEventListener('change', lock);
      root.style.overflow = previous;
    };
  }, [closeHref, router]);

  return (
    <aside ref={ref} aria-label={label} tabIndex={-1} className={r.aside}>
      {children}
    </aside>
  );
}

'use client';

import { useEffect } from 'react';

/**
 * On a phone the section list is a strip that scrolls sideways, and the
 * chosen section can sit off its right edge — so the screen says "Hours &
 * service" with no visible sign of which entry that is. This brings the current
 * entry into view, without moving the page.
 */
export function SettingsNavFocus({ listId }: { listId: string }) {
  useEffect(() => {
    const list = document.getElementById(listId);
    const current = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!list || !current) return;
    if (list.scrollWidth <= list.clientWidth) return;
    list.scrollLeft = current.offsetLeft - (list.clientWidth - current.offsetWidth) / 2;
  });
  return null;
}

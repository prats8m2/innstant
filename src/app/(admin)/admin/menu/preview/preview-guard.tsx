'use client';

import { useEffect } from 'react';

/**
 * Makes the preview look-only.
 *
 * The preview renders the real guest screen, steppers and links included,
 * because a lookalike would drift. The cost is that those controls are live,
 * and a manager who taps "+" in a preview must not reach a cart that does
 * not exist or leave the preview for a dish page with no session.
 *
 * So taps and form submissions are stopped in the CAPTURE phase on the
 * window, before React's root listener sees them. Scrolling and the section
 * rail still work.
 */
export function PreviewGuard() {
  useEffect(() => {
    const stop = (event: Event) => {
      const target = event.target as Element | null;
      // The section rail only scrolls the page, which is exactly what a
      // preview is for.
      if (target?.closest('[role="tablist"]')) return;
      if (event.type === 'submit' || target?.closest('a, button, input, select, textarea')) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('click', stop, true);
    window.addEventListener('submit', stop, true);
    return () => {
      window.removeEventListener('click', stop, true);
      window.removeEventListener('submit', stop, true);
    };
  }, []);

  return null;
}

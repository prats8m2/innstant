'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './menu.module.css';

/**
 * The sticky category rail.
 *
 * A client component for one reason: it tracks which section is under the
 * header as the page scrolls, and moves the saffron pill to match. Everything
 * else on this screen is server-rendered — the menu itself does not need
 * JavaScript to be read, which matters on hotel wifi.
 *
 * The pill is a single translating element rather than a background on each
 * chip, exactly as the reference does it: one transform animates, and the
 * chips only change colour.
 */
export interface RailSection {
  id: string;
  label: string;
}

/** Roughly the header's height — a section counts as active once its top has
 *  passed under the bar rather than when it reaches the top of the viewport. */
const HEADER_OFFSET = 170;

export function CategoryRail({ sections }: { sections: RailSection[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? '');
  const railRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);

  // Scroll spy. Reads positions in a scroll handler rather than with an
  // IntersectionObserver because sections are taller than the viewport, so
  // "which one is under the header" is the question — not "which is visible".
  useEffect(() => {
    const onScroll = () => {
      const marks = Array.from(document.querySelectorAll<HTMLElement>('[data-section]'));
      let current = marks[0]?.id ?? '';
      for (const mark of marks) {
        if (mark.getBoundingClientRect().top <= HEADER_OFFSET) current = mark.id;
      }
      setActive((prev) => (prev === current ? prev : current));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Move the pill under the active chip, and keep that chip in view — with
  // nine sections the rail scrolls, and the active one can sit off-screen.
  useEffect(() => {
    const rail = railRef.current;
    const pill = pillRef.current;
    if (!rail || !pill) return;

    const chip = rail.querySelector<HTMLElement>(`[data-chip="${CSS.escape(active)}"]`);
    if (!chip) return;

    pill.style.width = `${chip.offsetWidth}px`;
    pill.style.transform = `translateX(${chip.offsetLeft - rail.scrollLeft}px)`;

    const left = chip.offsetLeft - rail.scrollLeft;
    if (left < 0 || left + chip.offsetWidth > rail.clientWidth) {
      rail.scrollTo({ left: chip.offsetLeft - 12, behavior: 'smooth' });
    }
  }, [active]);

  const jump = (id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    // Scroll the section clear of the sticky header. `scroll-margin-top` in
    // the stylesheet does this for the anchor; this keeps the two in step for
    // a programmatic jump.
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(id);
  };

  return (
    <div ref={railRef} className={styles.rail} role="tablist" aria-label="Menu sections">
      <span ref={pillRef} className={styles.pill} aria-hidden="true" />
      {sections.map((section) => (
        <button
          key={section.id}
          type="button"
          data-chip={section.id}
          role="tab"
          aria-selected={active === section.id}
          aria-controls={section.id}
          className={styles.chip}
          onClick={() => jump(section.id)}
        >
          {section.label}
        </button>
      ))}
    </div>
  );
}

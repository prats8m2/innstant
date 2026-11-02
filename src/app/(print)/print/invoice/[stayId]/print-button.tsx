'use client';

import { Printer } from 'lucide-react';
import p from './invoice.module.css';

/** The browser's own print dialog — which is also "Save as PDF". */
export function PrintButton() {
  return (
    <button type="button" className={p.print} onClick={() => window.print()}>
      <Printer size={16} aria-hidden="true" /> Print or save as PDF
    </button>
  );
}

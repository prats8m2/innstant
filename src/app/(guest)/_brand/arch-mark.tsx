/**
 * The small arch beside the wordmark — Midnight's mark, as the boards draw it
 * (`design/reference/midnight/`). Hand-drawn because it is the brand, not an
 * icon (CLAUDE.md: illustration is not iconography).
 *
 * `double` is the Home board's mark, with the second, fainter arch inside;
 * the Welcome board draws the single one. Stroke and dot are the accent, read
 * through `currentColor` from the stylesheet that places it.
 */
export function ArchMark({ className, double = false }: { className?: string; double?: boolean }) {
  return (
    <svg
      className={className}
      viewBox="0 0 22 26"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M1 25V11C1 5.5 5.5 1 11 1s10 4.5 10 10v14" stroke="currentColor" strokeWidth="1.2" />
      {double ? (
        <path
          d="M5 25V12c0-3.3 2.7-6 6-6s6 2.7 6 6v13"
          stroke="currentColor"
          strokeWidth="1.2"
          opacity="0.55"
        />
      ) : null}
      <circle cx="11" cy="18" r="2" fill="currentColor" />
    </svg>
  );
}

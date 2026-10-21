/**
 * The brand mark is an open ledger: the left page holds ruled entries, the
 * right page carries a rising line. Recording on one side, direction on the
 * other — the two halves of what the app is for.
 */
export function BrandMark() {
  return (
    <svg
      className="brand-mark-glyph"
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M14 7.1C12.2 5.6 10 4.9 7.6 4.9H3.6V21.1H7.9C10.3 21.1 12.4 21.7 14 23.1C15.6 21.7 17.7 21.1 20.1 21.1H24.4V4.9H20.4C18 4.9 15.8 5.6 14 7.1Z"
        fill="currentColor"
        fillOpacity="0.08"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
      <path
        d="M14 7.1V23.1"
        stroke="currentColor"
        strokeWidth="1.1"
        opacity="0.55"
      />
      <path
        d="M6.6 9.6H10.1M6.6 12.4H9.4M6.6 15.2H8.8"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      <path
        d="M16.8 16.9L19 14.3L20.8 15.6L23.3 12.1"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="23.3" cy="12.1" r="1.15" fill="currentColor" />
    </svg>
  )
}

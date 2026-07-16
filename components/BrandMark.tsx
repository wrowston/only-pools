/**
 * Brand mark — single-elimination bracket glyph (4 → 2 → 1).
 */
export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-grid h-5 w-5 shrink-0 place-items-center ${className}`}
      aria-hidden
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 18 18"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="
            M1.5 2H5.5V5H9.5
            M1.5 8H5.5V5
            M1.5 10H5.5V13H9.5
            M1.5 16H5.5V13
            M9.5 5V13
            M9.5 9H16.5
          "
          stroke="#fa5d19"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

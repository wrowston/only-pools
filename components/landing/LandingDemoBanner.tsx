/**
 * Top-of-page announcement on the marketing landing page.
 */
export function LandingDemoBanner() {
  return (
    <div
      role="status"
      aria-live="polite"
      data-landing-demo-banner
      className="border-b border-op-banner-border bg-op-banner-bg px-4 py-2.5 text-center text-sm font-medium text-op-banner-fg"
    >
      Demo for a cloud agent — welcome to Cursor 101
    </div>
  );
}

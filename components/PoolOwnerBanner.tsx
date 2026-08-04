import { LinkifiedText } from "./LinkifiedText";

/**
 * Sticky announcement from the Pool Owner/Admin across every in-pool view.
 */
export function PoolOwnerBanner({ message }: { message: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-pool-owner-banner
      className="sticky top-0 z-10 border-b border-op-banner-border bg-op-banner-bg px-4 py-2.5 text-sm text-op-banner-fg min-[900px]:px-6"
    >
      <p className="whitespace-pre-wrap">
        <span className="sr-only">Pool announcement: </span>
        <LinkifiedText text={message} />
      </p>
    </div>
  );
}

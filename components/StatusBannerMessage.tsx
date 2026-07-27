export type ParticipantStatusBanner = {
  status: string;
  severity: "warning" | "critical";
  summary: string;
  maintenanceLock: false;
  lastSuccessfulUpdateAtMs?: number | null;
};

export function StatusBannerMessage({
  banner,
}: {
  banner: ParticipantStatusBanner;
}) {
  const showsLiveFreshness =
    "lastSuccessfulUpdateAtMs" in banner;

  return (
    <div
      role="status"
      aria-live="polite"
      data-status-banner={banner.severity}
      data-incident-status={banner.status}
      data-live-region="incident-banner"
      className="border-b border-op-banner-border bg-op-banner-bg px-6 py-3 text-sm text-op-banner-fg"
    >
      <span>{banner.summary}</span>
      {showsLiveFreshness ? (
        banner.lastSuccessfulUpdateAtMs === null ||
        banner.lastSuccessfulUpdateAtMs === undefined ? (
          <>
            {" "}
            <span>No successful live update yet.</span>
          </>
        ) : (
          <>
            {" "}
            <span>
              Last successful live update{" "}
              <time
                dateTime={new Date(
                  banner.lastSuccessfulUpdateAtMs,
                ).toISOString()}
              >
                {new Date(
                  banner.lastSuccessfulUpdateAtMs,
                ).toLocaleString()}
              </time>
              .
            </span>
          </>
        )
      ) : null}
    </div>
  );
}

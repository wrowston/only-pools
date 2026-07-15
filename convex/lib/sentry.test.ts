import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  captureException,
  captureIncidentSignal,
  mayPageProduction,
  sentrySink,
} from "./sentry";

describe("sentry sink (scenario 44 — Preview/Dev never page production)", () => {
  const prevKind = process.env.DEPLOYMENT_KIND;
  const prevDsn = process.env.SENTRY_DSN;
  const prevPublic = process.env.NEXT_PUBLIC_SENTRY_DSN;

  beforeEach(() => {
    sentrySink.reset();
  });

  afterEach(() => {
    if (prevKind === undefined) delete process.env.DEPLOYMENT_KIND;
    else process.env.DEPLOYMENT_KIND = prevKind;
    if (prevDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = prevDsn;
    if (prevPublic === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    else process.env.NEXT_PUBLIC_SENTRY_DSN = prevPublic;
    sentrySink.reset();
  });

  it("records captures when DSN is unset (no-op logger for tests)", () => {
    delete process.env.SENTRY_DSN;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    process.env.DEPLOYMENT_KIND = "development";

    captureException(new Error("sync failed"), {
      tags: { surface: "live" },
    });

    expect(sentrySink.captures).toHaveLength(1);
    expect(sentrySink.captures[0]!.message).toBe("sync failed");
    expect(sentrySink.captures[0]!.pagesProduction).toBe(false);
  });

  it("Dev with a DSN still does not page production", () => {
    process.env.DEPLOYMENT_KIND = "development";
    process.env.SENTRY_DSN = "https://example@o0.ingest.sentry.io/0";

    const event = captureIncidentSignal({
      signal: "opened",
      incidentType: "provider_exception",
      dedupeKey: "provider_exception:live:window",
    });

    expect(event.pagesProduction).toBe(false);
    expect(mayPageProduction()).toBe(false);
    expect(event.tags?.alert_channel).toBeUndefined();
  });

  it("production with DSN is eligible to page production", () => {
    process.env.DEPLOYMENT_KIND = "production";
    process.env.SENTRY_DSN = "https://example@o0.ingest.sentry.io/0";

    const event = captureIncidentSignal({
      signal: "escalated",
      incidentType: "stale_in_window",
      dedupeKey: "stale_in_window:live:window",
    });

    expect(event.pagesProduction).toBe(true);
    expect(mayPageProduction()).toBe(true);
    expect(event.tags?.alert_channel).toBe("production");
  });

  it("production without DSN does not page", () => {
    process.env.DEPLOYMENT_KIND = "production";
    delete process.env.SENTRY_DSN;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;

    expect(mayPageProduction()).toBe(false);
    const event = captureException("scoring boom");
    expect(event.pagesProduction).toBe(false);
  });
});

/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { api, internal } from "./_generated/api";
import {
  LIVE_INGESTION_CRITICAL_MS,
  LIVE_INGESTION_WARNING_MS,
} from "./lib/liveIngestionWatchdog";
import { sentrySink } from "./lib/sentry";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const WINDOW_STARTED_AT_MS = Date.UTC(2026, 8, 13, 16, 45);
const KICKOFF_MS = WINDOW_STARTED_AT_MS + 15 * 60_000;

function identity(subject: string) {
  return {
    subject,
    issuer: "https://clerk.example",
    name: subject,
    email: `${subject}@example.test`,
    emailVerified: true,
    phoneNumber: "+15551234567",
    phoneNumberVerified: true,
    ageConfirmed: true,
    sid: `session_${subject}`,
  };
}

async function seedActiveWindow(
  t: ReturnType<typeof convexTest>,
  options: { irrelevantGames?: number } = {},
) {
  return await t.run(async (ctx) => {
    const seasonId = await ctx.db.insert("poolSeasons", {
      label: "2026",
      year: 2026,
      status: "available",
      usableStartWeek: 1,
      bootstrappedAtMs: WINDOW_STARTED_AT_MS,
    });
    const homeTeamId = await ctx.db.insert("nflTeams", {
      stableKey: "nfl-team:home",
      name: "Home",
      abbreviation: "HOM",
    });
    const awayTeamId = await ctx.db.insert("nflTeams", {
      stableKey: "nfl-team:away",
      name: "Away",
      abbreviation: "AWY",
    });
    for (let index = 0; index < (options.irrelevantGames ?? 0); index += 1) {
      await ctx.db.insert("nflGames", {
        stableKey: `nfl:2026:irrelevant:${index}`,
        seasonId,
        seasonLabel: "2026",
        week: 2,
        homeTeamId,
        awayTeamId,
        scheduledKickoffMs: WINDOW_STARTED_AT_MS - index - 1,
        lifecycle: "terminal",
        homeScore: 1,
        awayScore: 0,
        resultAuthority: "verified",
      });
    }
    await ctx.db.insert("nflGames", {
      stableKey: "nfl:2026:w1:away@home",
      seasonId,
      seasonLabel: "2026",
      week: 1,
      homeTeamId,
      awayTeamId,
      scheduledKickoffMs: KICKOFF_MS,
      lifecycle: "scheduled",
      homeScore: null,
      awayScore: null,
      resultAuthority: "none",
    });
    return seasonId;
  });
}

describe("API-Sports live ingestion watchdog", () => {
  const previousKind = process.env.DEPLOYMENT_KIND;
  const previousDsn = process.env.SENTRY_DSN;
  const previousEmailEnabled =
    process.env.SENTRY_INCIDENT_EMAIL_ENABLED;
  const previousOperator = process.env.PRODUCTION_OPERATOR_CLERK_USER_ID;

  beforeEach(() => {
    process.env.DEPLOYMENT_KIND = "development";
    delete process.env.SENTRY_DSN;
    delete process.env.SENTRY_INCIDENT_EMAIL_ENABLED;
    process.env.PRODUCTION_OPERATOR_CLERK_USER_ID = "operator";
    sentrySink.reset();
  });

  afterEach(() => {
    if (previousKind === undefined) delete process.env.DEPLOYMENT_KIND;
    else process.env.DEPLOYMENT_KIND = previousKind;
    if (previousDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = previousDsn;
    if (previousEmailEnabled === undefined) {
      delete process.env.SENTRY_INCIDENT_EMAIL_ENABLED;
    } else {
      process.env.SENTRY_INCIDENT_EMAIL_ENABLED =
        previousEmailEnabled;
    }
    if (previousOperator === undefined) {
      delete process.env.PRODUCTION_OPERATOR_CLERK_USER_ID;
    } else {
      process.env.PRODUCTION_OPERATOR_CLERK_USER_ID = previousOperator;
    }
    sentrySink.reset();
  });

  it("opens one operator warning at 90 seconds without consuming provider quota", async () => {
    const t = convexTest(schema, modules);
    await seedActiveWindow(t);

    const before = await t.mutation(
      internal.liveIngestionWatchdog.evaluate,
      { nowMs: WINDOW_STARTED_AT_MS + LIVE_INGESTION_WARNING_MS - 1 },
    );
    expect(before.state).toBe("healthy");

    const warning = await t.mutation(
      internal.liveIngestionWatchdog.evaluate,
      { nowMs: WINDOW_STARTED_AT_MS + LIVE_INGESTION_WARNING_MS },
    );
    const duplicate = await t.mutation(
      internal.liveIngestionWatchdog.evaluate,
      { nowMs: WINDOW_STARTED_AT_MS + LIVE_INGESTION_WARNING_MS + 29_999 },
    );
    expect(warning).toMatchObject({ state: "warning", opened: true });
    expect(duplicate).toMatchObject({
      state: "warning",
      opened: false,
      deduped: true,
    });

    const state = await t.run(async (ctx) => ({
      incidents: await ctx.db.query("operatorIncidents").collect(),
      claims: await ctx.db.query("providerFetchClaims").collect(),
      reliability: await ctx.db.query("providerReliabilityState").collect(),
    }));
    expect(state.incidents).toHaveLength(1);
    expect(state.incidents[0]).toMatchObject({
      severity: "warning",
      participantVisible: false,
    });
    expect(state.claims).toHaveLength(0);
    expect(state.reliability).toHaveLength(0);
    expect(
      sentrySink.captures.filter((capture) =>
        capture.tags?.signal === "opened"
      ),
    ).toHaveLength(1);
  });

  it("finds the indexed active candidate beyond hundreds of irrelevant games", async () => {
    const t = convexTest(schema, modules);
    await seedActiveWindow(t, { irrelevantGames: 401 });
    const warning = await t.mutation(
      internal.liveIngestionWatchdog.evaluate,
      { nowMs: WINDOW_STARTED_AT_MS + LIVE_INGESTION_WARNING_MS },
    );
    expect(warning).toMatchObject({ state: "warning", opened: true });
  });

  it("serializes concurrent warning ticks into one episode and one opening signal", async () => {
    const t = convexTest(schema, modules);
    await seedActiveWindow(t);
    await Promise.all([
      t.mutation(internal.liveIngestionWatchdog.evaluate, {
        nowMs: WINDOW_STARTED_AT_MS + LIVE_INGESTION_WARNING_MS,
      }),
      t.mutation(internal.liveIngestionWatchdog.evaluate, {
        nowMs: WINDOW_STARTED_AT_MS + LIVE_INGESTION_WARNING_MS,
      }),
    ]);
    const incidents = await t.run(async (ctx) =>
      ctx.db.query("operatorIncidents").collect()
    );
    expect(incidents).toHaveLength(1);
    expect(
      sentrySink.captures.filter(
        (capture) => capture.tags?.signal === "opened",
      ),
    ).toHaveLength(1);
  });

  it("opens critical directly on a late first tick without a synthetic warning", async () => {
    const t = convexTest(schema, modules);
    await seedActiveWindow(t);
    const result = await t.mutation(
      internal.liveIngestionWatchdog.evaluate,
      { nowMs: WINDOW_STARTED_AT_MS + LIVE_INGESTION_CRITICAL_MS },
    );
    expect(result).toMatchObject({ state: "critical", opened: true });
    expect(sentrySink.captures).toHaveLength(1);
    expect(sentrySink.captures[0]).toMatchObject({
      level: "error",
      tags: { signal: "opened", severity: "critical" },
    });
  });

  it("escalates the same incident at 120 seconds and exposes sanitized delay timing to participants", async () => {
    const t = convexTest(schema, modules);
    await seedActiveWindow(t);
    const participant = t.withIdentity(identity("participant"));
    await participant.mutation(api.participants.ensureMyParticipant, {});

    await t.mutation(internal.liveIngestionWatchdog.evaluate, {
      nowMs: WINDOW_STARTED_AT_MS + LIVE_INGESTION_WARNING_MS,
    });
    const warningBanner = await participant.query(
      api.incidents.getParticipantStatusBanner,
      {},
    );
    expect(warningBanner).toBeNull();

    const escalated = await t.mutation(
      internal.liveIngestionWatchdog.evaluate,
      { nowMs: WINDOW_STARTED_AT_MS + LIVE_INGESTION_CRITICAL_MS },
    );
    expect(escalated).toMatchObject({
      state: "critical",
      escalated: true,
    });

    const incidents = await t.run(async (ctx) =>
      ctx.db.query("operatorIncidents").collect()
    );
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({
      severity: "critical",
      participantVisible: true,
    });
    expect(incidents[0]).not.toHaveProperty(
      "lastSuccessfulIngestionAtMs",
    );

    const banner = await participant.query(
      api.incidents.getParticipantStatusBanner,
      {},
    );
    expect(banner).toMatchObject({
      severity: "critical",
      lastSuccessfulUpdateAtMs: null,
    });
    expect(banner?.summary).toMatch(/scores are delayed/i);
    expect(Object.keys(banner!).sort()).toEqual([
      "lastSuccessfulUpdateAtMs",
      "maintenanceLock",
      "severity",
      "status",
      "summary",
    ]);
    const firstVisit = t.withIdentity(identity("first_visit"));
    await expect(
      firstVisit.query(api.incidents.getParticipantStatusBanner, {}),
    ).resolves.toMatchObject({
      summary: "Scores are delayed.",
      severity: "critical",
    });
    expect(
      sentrySink.captures.filter((capture) =>
        capture.tags?.signal === "escalated"
      ),
    ).toHaveLength(1);
  });

  it("uses a successful expected ingestion as the clock and resolves on healthy ingestion", async () => {
    const t = convexTest(schema, modules);
    await seedActiveWindow(t);
    const successAtMs = WINDOW_STARTED_AT_MS + 30_000;
    const participant = t.withIdentity(identity("participant"));
    await participant.mutation(api.participants.ensureMyParticipant, {});

    await t.mutation(internal.syncLive.recordSyncSurfaceHealth, {
      surface: "league_live",
      scopeKey: "live:nfl",
      success: true,
      nowMs: successAtMs,
      expectedNextRefreshAtMs: successAtMs + 60_000,
    });
    const warning = await t.mutation(
      internal.liveIngestionWatchdog.evaluate,
      { nowMs: successAtMs + LIVE_INGESTION_WARNING_MS },
    );
    expect(warning.state).toBe("warning");
    await t.mutation(internal.liveIngestionWatchdog.evaluate, {
      nowMs: successAtMs + LIVE_INGESTION_CRITICAL_MS,
    });
    const banner = await participant.query(
      api.incidents.getParticipantStatusBanner,
      {},
    );
    expect(banner).toMatchObject({
      summary: "Scores are delayed.",
      lastSuccessfulUpdateAtMs: successAtMs,
    });

    await t.mutation(internal.syncLive.recordSyncSurfaceHealth, {
      surface: "league_live",
      scopeKey: "live:nfl",
      success: true,
      nowMs: successAtMs + LIVE_INGESTION_CRITICAL_MS + 1,
      expectedNextRefreshAtMs:
        successAtMs + LIVE_INGESTION_CRITICAL_MS + 60_001,
    });

    const incident = await t.run(async (ctx) =>
      ctx.db.query("operatorIncidents").first()
    );
    expect(incident).toMatchObject({
      status: "resolved",
      resolvedAutomatically: true,
    });
    expect(
      sentrySink.captures.some((capture) =>
        capture.tags?.signal === "resolved"
      ),
    ).toBe(true);
  });

  it("ignores an out-of-order success without rolling freshness backward or resolving a newer episode", async () => {
    const t = convexTest(schema, modules);
    await seedActiveWindow(t);
    const acceptedAtMs = WINDOW_STARTED_AT_MS + 30_000;
    await t.mutation(internal.syncLive.recordSyncSurfaceHealth, {
      surface: "league_live",
      scopeKey: "live:nfl",
      success: true,
      nowMs: acceptedAtMs,
      expectedNextRefreshAtMs: acceptedAtMs + 60_000,
    });
    await t.mutation(internal.liveIngestionWatchdog.evaluate, {
      nowMs: acceptedAtMs + LIVE_INGESTION_CRITICAL_MS,
    });

    await t.mutation(internal.syncLive.recordSyncSurfaceHealth, {
      surface: "league_live",
      scopeKey: "live:nfl",
      success: true,
      nowMs: acceptedAtMs - 1,
      expectedNextRefreshAtMs: acceptedAtMs + 59_999,
    });
    const direct = await t.mutation(
      internal.liveIngestionWatchdog
        .recordSuccessfulExpectedIngestion,
      { nowMs: acceptedAtMs - 1 },
    );
    expect(direct).toMatchObject({ resolved: false, stale: true });

    const state = await t.run(async (ctx) => ({
      health: await ctx.db
        .query("syncSurfaceHealth")
        .withIndex("by_surface_and_scopeKey", (q) =>
          q.eq("surface", "league_live").eq("scopeKey", "live:nfl"),
        )
        .unique(),
      watchdog: await ctx.db
        .query("liveIngestionWatchdogState")
        .withIndex("by_key", (q) => q.eq("key", "live:nfl"))
        .unique(),
      incident: await ctx.db.query("operatorIncidents").unique(),
    }));
    expect(state.health).toMatchObject({
      lastSuccessAtMs: acceptedAtMs,
      expectedNextRefreshAtMs: acceptedAtMs + 60_000,
    });
    expect(state.watchdog).toMatchObject({
      lastSuccessfulExpectedIngestionAtMs: acceptedAtMs,
    });
    expect(state.incident).toMatchObject({
      status: "open",
      severity: "critical",
    });
    expect(state.incident).not.toHaveProperty("resolvedAtMs");
  });

  it("preserves operator workflow status when warning escalates", async () => {
    const t = convexTest(schema, modules);
    await seedActiveWindow(t);
    await t.mutation(internal.liveIngestionWatchdog.evaluate, {
      nowMs: WINDOW_STARTED_AT_MS + LIVE_INGESTION_WARNING_MS,
    });
    await t.run(async (ctx) => {
      const incident = await ctx.db.query("operatorIncidents").unique();
      await ctx.db.patch(incident!._id, {
        status: "acknowledged",
        acknowledgedAtMs:
          WINDOW_STARTED_AT_MS + LIVE_INGESTION_WARNING_MS + 1,
      });
    });
    await t.mutation(internal.liveIngestionWatchdog.evaluate, {
      nowMs: WINDOW_STARTED_AT_MS + LIVE_INGESTION_CRITICAL_MS,
    });
    const incident = await t.run(async (ctx) =>
      ctx.db.query("operatorIncidents").unique()
    );
    expect(incident).toMatchObject({
      status: "acknowledged",
      severity: "critical",
      participantVisible: true,
    });
  });

  it("keeps live transport failures operator-only until the watchdog threshold", async () => {
    const t = convexTest(schema, modules);
    await seedActiveWindow(t);
    const participant = t.withIdentity(identity("participant"));
    await participant.mutation(api.participants.ensureMyParticipant, {});

    await t.mutation(internal.syncLive.recordSyncSurfaceHealth, {
      surface: "league_live",
      scopeKey: "live:nfl",
      success: false,
      nowMs: WINDOW_STARTED_AT_MS + 10_000,
      providerException: true,
      exceptionMessage: "api_sports_live_fetch_failed",
    });
    expect(
      await participant.query(
        api.incidents.getParticipantStatusBanner,
        {},
      ),
    ).toBeNull();
    const incidents = await t.run(async (ctx) =>
      ctx.db.query("operatorIncidents").collect()
    );
    expect(incidents).toHaveLength(0);
  });

  it("resolves and hides the episode with a distinct cause when the live window ends", async () => {
    const t = convexTest(schema, modules);
    await seedActiveWindow(t);
    await t.mutation(internal.liveIngestionWatchdog.evaluate, {
      nowMs: WINDOW_STARTED_AT_MS + LIVE_INGESTION_CRITICAL_MS,
    });
    await t.run(async (ctx) => {
      const game = await ctx.db.query("nflGames").unique();
      await ctx.db.patch(game!._id, { lifecycle: "terminal" });
    });
    const result = await t.mutation(
      internal.liveIngestionWatchdog.evaluate,
      { nowMs: WINDOW_STARTED_AT_MS + LIVE_INGESTION_CRITICAL_MS + 1 },
    );
    expect(result).toMatchObject({ state: "inactive", resolved: true });
    const incident = await t.run(async (ctx) =>
      ctx.db.query("operatorIncidents").unique()
    );
    expect(incident).toMatchObject({
      status: "resolved",
      resolutionCause: "window_ended",
    });
    expect(
      sentrySink.captures.some(
        (capture) => capture.tags?.signal === "resolved",
      ),
    ).toBe(false);
  });

  it("keeps provider, quota, circuit, and exception detail operator-only", async () => {
    const t = convexTest(schema, modules);
    await seedActiveWindow(t);
    await t.mutation(
      internal.providerReliability.admitApiSportsRequest,
      {
        traffic: "protected",
        surface: "live",
        nowMs: WINDOW_STARTED_AT_MS,
      },
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("providerExceptions", {
        kind: "sync_failure",
        scopeKey: "live:nfl",
        message: "sanitized_live_failure",
        createdAtMs: WINDOW_STARTED_AT_MS + 1,
      });
      for (let index = 0; index < 25; index += 1) {
        await ctx.db.insert("providerExceptions", {
          kind: "sync_failure",
          scopeKey: `unrelated:${index}`,
          message: "unrelated_failure",
          createdAtMs: WINDOW_STARTED_AT_MS + index + 2,
        });
      }
    });
    await t.mutation(internal.liveIngestionWatchdog.evaluate, {
      nowMs: WINDOW_STARTED_AT_MS + LIVE_INGESTION_WARNING_MS,
    });

    const participant = t.withIdentity(identity("participant"));
    await expect(
      participant.query(api.incidents.listOperatorIncidents, {}),
    ).rejects.toThrow(/Production Operator/i);
    const operator = t.withIdentity(identity("operator"));
    const [incident] = await operator.query(
      api.incidents.listOperatorIncidents,
      {},
    );
    expect(incident.operatorDetails).toMatchObject({
      provider: "api-sports",
      quota: { dailyUsed: 1 },
      circuit: { status: "closed" },
      exception: { message: "sanitized_live_failure" },
    });
  });

  it("selects the newest visible incident from more than 200 rows with bounded reads", async () => {
    const t = convexTest(schema, modules);
    const participant = t.withIdentity(identity("participant"));
    await participant.mutation(api.participants.ensureMyParticipant, {});
    await t.run(async (ctx) => {
      for (let index = 0; index < 205; index += 1) {
        await ctx.db.insert("operatorIncidents", {
          type: "stale_in_window",
          status: "open",
          surface: "test",
          scopeKey: `scale:${index}`,
          dedupeKey: `stale_in_window:test:scale:${index}`,
          participantVisible: true,
          severity: index === 204 ? "critical" : "warning",
          summary: "internal summary",
          openedAtMs: index,
          maintenanceLock: false,
        });
      }
    });
    const banner = await participant.query(
      api.incidents.getParticipantStatusBanner,
      {},
    );
    expect(banner).toMatchObject({
      severity: "critical",
      summary: "internal summary",
    });
  });

  it("routes warning, critical, and recovery email signals only from production", async () => {
    const t = convexTest(schema, modules);
    await seedActiveWindow(t);

    await t.mutation(internal.liveIngestionWatchdog.evaluate, {
      nowMs: WINDOW_STARTED_AT_MS + LIVE_INGESTION_WARNING_MS,
    });
    expect(sentrySink.captures[0]).toMatchObject({
      level: "warning",
      pagesProduction: false,
    });
    expect(sentrySink.captures[0]?.tags?.notification_channel).toBeUndefined();

    process.env.DEPLOYMENT_KIND = "production";
    process.env.SENTRY_DSN = "https://key@example.ingest.sentry.io/1";
    process.env.SENTRY_INCIDENT_EMAIL_ENABLED = "true";
    await t.mutation(internal.liveIngestionWatchdog.evaluate, {
      nowMs: WINDOW_STARTED_AT_MS + LIVE_INGESTION_CRITICAL_MS,
    });
    await t.mutation(internal.syncLive.recordSyncSurfaceHealth, {
      surface: "league_live",
      scopeKey: "live:nfl",
      success: true,
      nowMs: WINDOW_STARTED_AT_MS + LIVE_INGESTION_CRITICAL_MS + 1,
    });

    const [critical, recovered] = sentrySink.captures.slice(-2);
    expect(critical).toMatchObject({
      level: "error",
      pagesProduction: true,
      tags: { notification_channel: "email", signal: "escalated" },
    });
    expect(recovered).toMatchObject({
      level: "info",
      pagesProduction: true,
      tags: { notification_channel: "email", signal: "resolved" },
    });
  });

  it("requires explicit production email routing configuration", async () => {
    process.env.DEPLOYMENT_KIND = "production";
    process.env.SENTRY_DSN =
      "https://key@example.ingest.sentry.io/1";
    delete process.env.SENTRY_INCIDENT_EMAIL_ENABLED;
    const t = convexTest(schema, modules);
    await seedActiveWindow(t);
    await t.mutation(internal.liveIngestionWatchdog.evaluate, {
      nowMs: WINDOW_STARTED_AT_MS + LIVE_INGESTION_WARNING_MS,
    });
    expect(sentrySink.captures[0]).toMatchObject({
      pagesProduction: true,
      tags: { alert_channel: "production" },
    });
    expect(
      sentrySink.captures[0]?.tags?.notification_channel,
    ).toBeUndefined();

    sentrySink.reset();
    process.env.DEPLOYMENT_KIND = "preview";
    process.env.SENTRY_INCIDENT_EMAIL_ENABLED = "true";
    const preview = convexTest(schema, modules);
    await seedActiveWindow(preview);
    await preview.mutation(internal.liveIngestionWatchdog.evaluate, {
      nowMs: WINDOW_STARTED_AT_MS + LIVE_INGESTION_WARNING_MS,
    });
    expect(sentrySink.captures[0]?.pagesProduction).toBe(false);
    expect(
      sentrySink.captures[0]?.tags?.notification_channel,
    ).toBeUndefined();
  });

  it("routes production warning and direct-critical openings to the configured email rule", async () => {
    process.env.DEPLOYMENT_KIND = "production";
    process.env.SENTRY_DSN =
      "https://key@example.ingest.sentry.io/1";
    process.env.SENTRY_INCIDENT_EMAIL_ENABLED = "true";

    const warningTest = convexTest(schema, modules);
    await seedActiveWindow(warningTest);
    await warningTest.mutation(
      internal.liveIngestionWatchdog.evaluate,
      { nowMs: WINDOW_STARTED_AT_MS + LIVE_INGESTION_WARNING_MS },
    );
    expect(sentrySink.captures[0]).toMatchObject({
      level: "warning",
      pagesProduction: true,
      tags: {
        notification_channel: "email",
        signal: "opened",
        severity: "warning",
      },
    });

    sentrySink.reset();
    const criticalTest = convexTest(schema, modules);
    await seedActiveWindow(criticalTest);
    await criticalTest.mutation(
      internal.liveIngestionWatchdog.evaluate,
      { nowMs: WINDOW_STARTED_AT_MS + LIVE_INGESTION_CRITICAL_MS },
    );
    expect(sentrySink.captures[0]).toMatchObject({
      level: "error",
      pagesProduction: true,
      tags: {
        notification_channel: "email",
        signal: "opened",
        severity: "critical",
      },
    });
  });

  it.each(["development", "preview"])(
    "defensively refuses direct Sentry delivery in %s",
    async (deploymentKind) => {
      process.env.DEPLOYMENT_KIND = deploymentKind;
      process.env.SENTRY_DSN =
        "https://key@example.ingest.sentry.io/1";
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      try {
        const t = convexTest(schema, modules);
        await t.action(internal.sentry.deliverCapture, {
          message: "must not page",
          level: "error",
          tags: {
            channel: "operator_incident",
            signal: "escalated",
          },
          atMs: WINDOW_STARTED_AT_MS,
        });
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );
});

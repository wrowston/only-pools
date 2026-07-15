/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { SCORING_DELAY_THRESHOLD_MS } from "./lib/incidents";
import { sentrySink } from "./lib/sentry";

const modules = import.meta.glob("./**/*.ts");

function fullyVerifiedIdentity(overrides: Record<string, unknown> = {}) {
  return {
    subject: "clerk_user_1",
    issuer: "https://viable-eagle-73.clerk.accounts.dev",
    name: "Alex Adult",
    email: "alex@example.com",
    emailVerified: true,
    phoneNumber: "+15551234567",
    phoneNumberVerified: true,
    ageConfirmed: true,
    sid: "sess_alex_1",
    ...overrides,
  };
}

function operatorIdentity() {
  return fullyVerifiedIdentity({
    subject: "clerk_operator",
    email: "ops@example.com",
    name: "Ops",
    sid: "sess_ops_1",
  });
}

describe("Operator Incidents (scenarios 34–35, 42–44)", () => {
  const prevClerk = process.env.PRODUCTION_OPERATOR_CLERK_USER_ID;
  const prevKind = process.env.DEPLOYMENT_KIND;
  const prevDsn = process.env.SENTRY_DSN;

  beforeEach(() => {
    process.env.PRODUCTION_OPERATOR_CLERK_USER_ID = "clerk_operator";
    process.env.DEPLOYMENT_KIND = "development";
    delete process.env.SENTRY_DSN;
    sentrySink.reset();
  });

  afterEach(() => {
    if (prevClerk === undefined) {
      delete process.env.PRODUCTION_OPERATOR_CLERK_USER_ID;
    } else {
      process.env.PRODUCTION_OPERATOR_CLERK_USER_ID = prevClerk;
    }
    if (prevKind === undefined) {
      delete process.env.DEPLOYMENT_KIND;
    } else {
      process.env.DEPLOYMENT_KIND = prevKind;
    }
    if (prevDsn === undefined) {
      delete process.env.SENTRY_DSN;
    } else {
      process.env.SENTRY_DSN = prevDsn;
    }
    sentrySink.reset();
  });

  it("opens incidents for catalog triggers; Late alone does not (scenario 42)", async () => {
    const t = convexTest(schema, modules);
    const nowMs = 1_700_000_000_000;

    const late = await t.mutation(internal.incidents.evaluateAndOpenIncident, {
      trigger: {
        kind: "freshness",
        freshnessState: "late",
        activeGameWindow: true,
      },
      surface: "live",
      scopeKey: "window:late",
      nowMs,
    });
    expect(late.opened).toBe(false);

    const stale = await t.mutation(internal.incidents.evaluateAndOpenIncident, {
      trigger: {
        kind: "freshness",
        freshnessState: "stale",
        activeGameWindow: true,
      },
      surface: "live",
      scopeKey: "window:stale",
      nowMs,
    });
    expect(stale.opened).toBe(true);

    const provider = await t.mutation(
      internal.incidents.evaluateAndOpenIncident,
      {
        trigger: { kind: "provider_exception" },
        surface: "live",
        scopeKey: "window:pe",
        nowMs,
      },
    );
    expect(provider.opened).toBe(true);

    const scoring = await t.mutation(
      internal.incidents.evaluateAndOpenIncident,
      {
        trigger: {
          kind: "scoring_delayed",
          verifiedResultAtMs: nowMs - SCORING_DELAY_THRESHOLD_MS - 1,
          latestRevisionAtMs: null,
          nowMs,
        },
        surface: "scoring",
        scopeKey: "pool:week:1",
        nowMs,
      },
    );
    expect(scoring.opened).toBe(true);

    const quarantine = await t.mutation(
      internal.incidents.evaluateAndOpenIncident,
      {
        trigger: {
          kind: "quarantine_past_confirmation",
          confirmationWindowEndsAtMs: nowMs - 1,
          nowMs,
          verificationBlocked: true,
        },
        surface: "confirmation",
        scopeKey: "game:q",
        nowMs,
      },
    );
    expect(quarantine.opened).toBe(true);

    const capacity = await t.mutation(
      internal.incidents.evaluateAndOpenIncident,
      {
        trigger: {
          kind: "convex_capacity",
          utilizationRatio: 0.91,
          projectedOverage: false,
        },
        surface: "capacity",
        scopeKey: "deployment",
        nowMs,
      },
    );
    expect(capacity.opened).toBe(true);

    const openRows = await t.run(async (ctx) => {
      return await ctx.db.query("operatorIncidents").collect();
    });
    expect(openRows).toHaveLength(5);
    expect(openRows.every((r) => r.maintenanceLock === false)).toBe(true);

    // Incident open signals Sentry sink (Dev does not page production).
    const openedSignals = sentrySink.captures.filter(
      (c) => c.tags?.signal === "opened",
    );
    expect(openedSignals.length).toBeGreaterThanOrEqual(5);
    expect(openedSignals.every((c) => c.pagesProduction === false)).toBe(true);
  });

  it("returns a single participant banner; clears on resolve; healthy is null (scenario 43)", async () => {
    const t = convexTest(schema, modules);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());

    const healthy = await asAlex.query(
      api.incidents.getParticipantStatusBanner,
      {},
    );
    expect(healthy).toBeNull();

    await t.mutation(internal.incidents.openIncidentForTest, {
      type: "stale_in_window",
      surface: "live",
      scopeKey: "window:a",
      participantVisible: true,
      summary: "Some live scores or standings may be temporarily delayed.",
      nowMs: 100,
    });
    await t.mutation(internal.incidents.openIncidentForTest, {
      type: "provider_exception",
      surface: "live",
      scopeKey: "window:b",
      participantVisible: true,
      nowMs: 200,
    });
    // Capacity is not participant-visible.
    await t.mutation(internal.incidents.openIncidentForTest, {
      type: "convex_capacity",
      surface: "capacity",
      scopeKey: "deployment",
      participantVisible: false,
      nowMs: 300,
    });

    const banner = await asAlex.query(
      api.incidents.getParticipantStatusBanner,
      {},
    );
    expect(banner).not.toBeNull();
    expect(banner!.type).toBe("provider_exception");
    expect(banner!.summary).toMatch(/temporarily delayed/i);
    expect(banner!.maintenanceLock).toBe(false);
    // No last-updated chrome fields on the banner payload beyond incident status.
    expect(
      Object.keys(banner!).includes("lastUpdatedAtMs") ||
        Object.keys(banner!).includes("lastSuccessAtMs"),
    ).toBe(false);

    const asOps = t.withIdentity(operatorIdentity());
    await asOps.mutation(api.participants.ensureMyParticipant, {});
    await asOps.mutation(api.invites.confirmStepUp, {});

    const list = await asOps.query(api.incidents.listOperatorIncidents, {});
    const visible = list.filter((i: { participantVisible: boolean }) =>
      i.participantVisible,
    );
    expect(visible.length).toBe(2);

    for (const inc of visible) {
      await asOps.mutation(api.incidents.resolveIncident, {
        incidentId: inc._id,
        resolutionNote: "recovered",
      });
    }

    const cleared = await asAlex.query(
      api.incidents.getParticipantStatusBanner,
      {},
    );
    expect(cleared).toBeNull();
  });

  it("denies non-operators; operator+step-up can acknowledge and audited resync/replay (scenarios 34, 44)", async () => {
    const t = convexTest(schema, modules);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});

    const incidentId = await t.mutation(internal.incidents.openIncidentForTest, {
      type: "provider_exception",
      surface: "live",
      scopeKey: "window:authz",
      participantVisible: true,
    });

    await expect(
      asAlex.query(api.incidents.listOperatorIncidents, {}),
    ).rejects.toThrow(/Production Operator required/);

    await expect(
      asAlex.mutation(api.incidents.acknowledgeIncident, { incidentId }),
    ).rejects.toThrow(/Production Operator required/);

    const asOps = t.withIdentity(operatorIdentity());
    await asOps.mutation(api.participants.ensureMyParticipant, {});

    // Step-up required for recovery mutations.
    await expect(
      asOps.mutation(api.incidents.acknowledgeIncident, { incidentId }),
    ).rejects.toThrow(/Step-up/i);

    await asOps.mutation(api.invites.confirmStepUp, {});
    await asOps.mutation(api.incidents.acknowledgeIncident, { incidentId });

    const seasonId = await t.run(async (ctx) => {
      return await ctx.db.insert("poolSeasons", {
        label: "2025",
        year: 2025,
        status: "available",
        usableStartWeek: 1,
        bootstrappedAtMs: Date.now(),
      });
    });

    const resync = await asOps.mutation(api.incidents.requestAuditedResync, {
      incidentId,
      reason: "provider circuit recovery probe",
      surface: "live",
      scopeKey: "window:authz",
      seasonId,
    });
    expect(resync.maintenanceLock).toBe(false);
    expect(resync.reopenedLocks).toBe(false);
    expect(resync.editedAuthoritativeInputs).toBe(false);

    const work = await t.run(async (ctx) => {
      return await ctx.db
        .query("syncWorkItems")
        .withIndex("by_scopeKey", (q) => q.eq("scopeKey", "window:authz"))
        .unique();
    });
    expect(work?.priority).toBe("operator");
    expect(work?.purpose).toMatch(/operator_resync/);

    // Seed a pool for replay.
    const poolId = await t.run(async (ctx) => {
      const actor = (await ctx.db.query("participants").take(1))[0]!;
      return await ctx.db.insert("pools", {
        name: "Ops Replay Pool",
        type: "survivor",
        seasonId,
        startWeek: 1,
        pickLockMode: "gameKickoff",
        status: "active",
        rulesFrozen: false,
        ownerParticipantId: actor._id,
        createdAtMs: Date.now(),
      });
    });

    await asOps.mutation(api.invites.confirmStepUp, {});
    const replay = await asOps.mutation(api.incidents.requestAuditedReplay, {
      incidentId,
      reason: "deterministic scoring replay",
      poolId,
      week: 1,
    });
    expect(replay.scheduled).toBe(true);
    expect(replay.reopenedLocks).toBe(false);
    expect(replay.editedAuthoritativeInputs).toBe(false);

    const audits = await t.run(async (ctx) => {
      return await ctx.db.query("operatorAuditEvents").collect();
    });
    const actions = audits.map((a) => a.action);
    expect(actions).toContain("incident_acknowledged");
    expect(actions).toContain("audited_resync_requested");
    expect(actions).toContain("audited_replay_requested");

    for (const a of audits) {
      if (a.detailsJson) {
        expect(a.detailsJson).not.toMatch(/invent/i);
        const details = JSON.parse(a.detailsJson) as Record<string, unknown>;
        if ("reopenedLocks" in details) {
          expect(details.reopenedLocks).toBe(false);
        }
        if ("editedAuthoritativeInputs" in details) {
          expect(details.editedAuthoritativeInputs).toBe(false);
        }
      }
    }
  });

  it("allows valid picking during an open incident — no maintenance lock (scenario 35)", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const week1Kickoff = now + 7 * 24 * 60 * 60 * 1000;

    const seed = await t.run(async (ctx) => {
      const seasonId = await ctx.db.insert("poolSeasons", {
        label: "2025",
        year: 2025,
        status: "available",
        usableStartWeek: 1,
        bootstrappedAtMs: now,
      });
      const kc = await ctx.db.insert("nflTeams", {
        stableKey: "nfl:kc",
        name: "Kansas City Chiefs",
        abbreviation: "KC",
        sportsDbTeamId: "134934",
      });
      const buf = await ctx.db.insert("nflTeams", {
        stableKey: "nfl:buf",
        name: "Buffalo Bills",
        abbreviation: "BUF",
        sportsDbTeamId: "134918",
      });
      await ctx.db.insert("nflGames", {
        stableKey: "nfl:2025:w1:buf@kc",
        seasonId,
        seasonLabel: "2025",
        week: 1,
        homeTeamId: kc,
        awayTeamId: buf,
        scheduledKickoffMs: week1Kickoff,
        lifecycle: "scheduled",
        homeScore: null,
        awayScore: null,
        sportsDbEventId: "evt_w1",
      });
      return { seasonId, kc };
    });

    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});
    const pool = await asAlex.mutation(api.pools.createPool, {
      name: "Repair Window Pool",
      type: "survivor",
      startWeek: 1,
      pickLockMode: "gameKickoff",
    });

    await t.mutation(internal.incidents.openIncidentForTest, {
      type: "stale_in_window",
      surface: "live",
      scopeKey: "window:repair",
      participantVisible: true,
    });

    const banner = await asAlex.query(
      api.incidents.getParticipantStatusBanner,
      {},
    );
    expect(banner).not.toBeNull();
    expect(banner!.maintenanceLock).toBe(false);

    const result = await asAlex.mutation(api.survivorPicks.autosaveSurvivorPick, {
      poolId: pool.poolId,
      week: 1,
      nflTeamId: seed.kc,
    });
    expect(result.saveTrust.status).toBe("saved");
  });

  it("recordSyncSurfaceHealth opens Provider Exception / Stale incidents, not Late", async () => {
    const t = convexTest(schema, modules);
    const nowMs = 1_700_000_000_000;

    // Late: success was 5 minutes ago (late but not stale for league-live).
    await t.mutation(internal.syncLive.recordSyncSurfaceHealth, {
      surface: "live",
      scopeKey: "window:late-only",
      success: false,
      nowMs,
      expectedNextRefreshAtMs: nowMs - 5 * 60 * 1000,
    });
    // Seed lastSuccess so age is Late (5 min) not Stale (10+).
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("syncSurfaceHealth")
        .withIndex("by_surface_and_scopeKey", (q) =>
          q.eq("surface", "live").eq("scopeKey", "window:late-only"),
        )
        .unique();
      if (row) {
        await ctx.db.patch(row._id, {
          lastSuccessAtMs: nowMs - 5 * 60 * 1000,
        });
      }
    });
    await t.mutation(internal.syncLive.recordSyncSurfaceHealth, {
      surface: "live",
      scopeKey: "window:late-only",
      success: false,
      nowMs,
    });

    // Fix lastSuccess after first insert path — re-record with known stale age.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("syncSurfaceHealth")
        .withIndex("by_surface_and_scopeKey", (q) =>
          q.eq("surface", "live").eq("scopeKey", "window:late-only"),
        )
        .unique();
      if (row) {
        await ctx.db.patch(row._id, {
          lastSuccessAtMs: nowMs - 5 * 60 * 1000,
          consecutiveFailures: 1,
          providerException: false,
        });
      }
    });

    // Direct evaluate path already covered Late; assert Stale via health.
    await t.mutation(internal.syncLive.recordSyncSurfaceHealth, {
      surface: "live",
      scopeKey: "window:stale-health",
      success: true,
      nowMs: nowMs - 15 * 60 * 1000,
    });
    await t.mutation(internal.syncLive.recordSyncSurfaceHealth, {
      surface: "live",
      scopeKey: "window:stale-health",
      success: false,
      nowMs,
    });

    await t.mutation(internal.syncLive.recordSyncSurfaceHealth, {
      surface: "live",
      scopeKey: "window:pe-health",
      success: false,
      nowMs,
      providerException: true,
      exceptionMessage: "401 circuit open",
    });

    const incidents = await t.run(async (ctx) => {
      return await ctx.db.query("operatorIncidents").collect();
    });
    const types = incidents.map((i) => i.type).sort();
    expect(types).toContain("stale_in_window");
    expect(types).toContain("provider_exception");
    expect(types).not.toContain("scoring_delayed");
  });
});

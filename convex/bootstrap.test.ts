/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import {
  normalizeSeasonEvents,
  normalizeTeams,
  type SportsDbEvent,
  type SportsDbTeam,
} from "./providers/thesportsdb/adapter";
import teamsFixture from "./providers/thesportsdb/fixtures/teams_nfl.json";
import eventsFixture from "./providers/thesportsdb/fixtures/events_season_2025_sample.json";

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

describe("Season Bootstrap (acceptance scenarios 7, 28, 50)", () => {
  const prevClerk = process.env.PRODUCTION_OPERATOR_CLERK_USER_ID;
  const prevKind = process.env.DEPLOYMENT_KIND;

  beforeEach(() => {
    process.env.PRODUCTION_OPERATOR_CLERK_USER_ID = "clerk_operator";
    process.env.DEPLOYMENT_KIND = "development";
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
  });

  it("denies Season Bootstrap for non-operators", async () => {
    const t = convexTest(schema, modules);
    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});

    const teams = normalizeTeams(teamsFixture.teams as SportsDbTeam[]);
    const games = normalizeSeasonEvents(
      eventsFixture.events as SportsDbEvent[],
      "2025",
    );

    await expect(
      asAlex.mutation(api.bootstrap.runSeasonBootstrapNormalized, {
        seasonLabel: "2025",
        teams,
        games,
      }),
    ).rejects.toThrow(/Production Operator required/);
  });

  it("marks season Available and enables Create Pool after usable Start Week sync", async () => {
    const t = convexTest(schema, modules);
    const asOps = t.withIdentity(operatorIdentity());
    await asOps.mutation(api.participants.ensureMyParticipant, {});

    const teams = normalizeTeams(teamsFixture.teams as SportsDbTeam[]);
    const games = normalizeSeasonEvents(
      eventsFixture.events as SportsDbEvent[],
      "2025",
    );

    const result = await asOps.mutation(
      api.bootstrap.runSeasonBootstrapNormalized,
      {
        seasonLabel: "2025",
        teams,
        games,
        nowMs: Date.parse("2025-08-01T00:00:00Z"),
      },
    );

    expect(result.status).toBe("available");
    expect(result.usableStartWeek).toBe(1);
    expect(result.syncGateEnabled).toBe(false); // Dev default OFF
    expect(result.gameCount).toBeGreaterThan(0);

    const lions = await t.run(async (ctx) => {
      return await ctx.db
        .query("nflTeams")
        .withIndex("by_stableKey", (q) =>
          q.eq("stableKey", "nfl-team:134939"),
        )
        .unique();
    });
    expect(lions?.logoUrl).toBe(
      "https://r2.thesportsdb.com/images/media/team/badge/lgsgkr1546168257.png",
    );

    const home = await asOps.query(api.participants.myPools, {});
    expect(home.createPoolEnabled).toBe(true);

    const audits = await t.run(async (ctx) => {
      return await ctx.db.query("operatorAuditEvents").collect();
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe("season_bootstrap");
  });

  it("keeps Create Pool disabled when bootstrap yields no usable Start Week", async () => {
    const t = convexTest(schema, modules);
    const asOps = t.withIdentity(operatorIdentity());
    await asOps.mutation(api.participants.ensureMyParticipant, {});

    const teams = normalizeTeams(teamsFixture.teams as SportsDbTeam[]);
    const result = await asOps.mutation(
      api.bootstrap.runSeasonBootstrapNormalized,
      {
        seasonLabel: "2025",
        teams,
        games: [],
      },
    );

    expect(result.status).toBe("bootstrapping");
    expect(result.usableStartWeek).toBeNull();

    const home = await asOps.query(api.participants.myPools, {});
    expect(home.createPoolEnabled).toBe(false);
  });

  it("sets Sync Gate ON after bootstrap when DEPLOYMENT_KIND=production", async () => {
    process.env.DEPLOYMENT_KIND = "production";
    const t = convexTest(schema, modules);
    const asOps = t.withIdentity(operatorIdentity());
    await asOps.mutation(api.participants.ensureMyParticipant, {});

    const teams = normalizeTeams(teamsFixture.teams as SportsDbTeam[]);
    const games = normalizeSeasonEvents(
      eventsFixture.events as SportsDbEvent[],
      "2025",
    );

    const result = await asOps.mutation(
      api.bootstrap.runSeasonBootstrapNormalized,
      { seasonLabel: "2025", teams, games },
    );
    expect(result.syncGateEnabled).toBe(true);
  });
});

describe("Sync Gate fetch claims (acceptance scenario 50)", () => {
  it("denies new fetch claims when gate is OFF but ordinary queries still work", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.sync.ensureSyncGate, { enabled: false });

    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});

    await t.run(async (ctx) => {
      await ctx.db.insert("nflTeams", {
        stableKey: "nfl-team:134939",
        name: "Detroit Lions",
        abbreviation: "DET",
        sportsDbTeamId: "134939",
      });
    });

    const claim = await asAlex.mutation(api.sync.claimProviderFetch, {
      surface: "schedule",
    });
    expect(claim).toEqual({ ok: false, reason: "sync_gate_off" });

    const teams = await asAlex.query(api.sync.listNflTeamSummaries, {});
    expect(teams).toEqual([
      expect.objectContaining({ name: "Detroit Lions", abbreviation: "DET" }),
    ]);

    const gate = await asAlex.query(api.sync.getSyncGateState, {});
    expect(gate.enabled).toBe(false);
  });

  it("allows fetch claims when Sync Gate is ON", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.sync.ensureSyncGate, { enabled: true });

    const asAlex = t.withIdentity(fullyVerifiedIdentity());
    await asAlex.mutation(api.participants.ensureMyParticipant, {});

    const claim = await asAlex.mutation(api.sync.claimProviderFetch, {
      surface: "live",
    });
    expect(claim).toEqual({ ok: true, surface: "live" });
  });
});

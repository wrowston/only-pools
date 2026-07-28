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
import schema from "./schema";
import type {
  SportsDataGame,
  SportsDataTeam,
} from "./providers/sportsData/types";
import {
  completeSeasonBootstrapGames,
  completeSeasonBootstrapTeams,
  SEASON_BOOTSTRAP_FIXTURE_OBSERVED_AT_MS,
  SEASON_BOOTSTRAP_FIXTURE_YEAR,
} from "./providers/sportsData/testing/seasonBootstrapFixture";

const modules = import.meta.glob("./**/*.ts");
const seasonYear = SEASON_BOOTSTRAP_FIXTURE_YEAR;
const nowMs = SEASON_BOOTSTRAP_FIXTURE_OBSERVED_AT_MS;

function identity(subject: string) {
  return {
    subject,
    issuer: "https://auth.example.test",
    tokenIdentifier: `https://auth.example.test|${subject}`,
  };
}

const completeTeams = completeSeasonBootstrapTeams;
const completeGames = completeSeasonBootstrapGames;

function stagedTeams(teams: readonly SportsDataTeam[] = completeTeams()) {
  return teams.map((team) => ({
    ...team,
    providerAliases: team.providerAliases.map((alias) => ({ ...alias })),
  }));
}

function stagedGames(games: readonly SportsDataGame[] = completeGames()) {
  return games.map((game) => ({
    ...game,
    providerAliases: game.providerAliases.map((alias) => ({ ...alias })),
  }));
}

function apiSportsFetch(input: {
  teamRows?: readonly Readonly<{
    id: number;
    name: string;
    code: string | null;
    logo: string | null;
  }>[];
  games?: readonly SportsDataGame[];
  malformedGames?: boolean;
  conflictingGameTeamId?: boolean;
}): typeof fetch {
  const canonicalTeams = completeTeams();
  const teamRows =
    input.teamRows ??
    canonicalTeams.map((team, index) => ({
      id: 10_000 + index,
      name: team.name,
      code: team.abbreviation,
      logo: team.logoUrl,
    }));
  const games = input.games ?? completeGames();

  return async (request) => {
    const url = new URL(
      typeof request === "string"
        ? request
        : request instanceof URL
          ? request
          : request.url,
    );
    if (url.pathname === "/teams") {
      return new Response(
        JSON.stringify({ errors: [], response: teamRows }),
        { status: 200 },
      );
    }
    if (url.pathname === "/games" && input.malformedGames) {
      return new Response(
        JSON.stringify({
          errors: [],
          response: [{ game: { id: "malformed" } }],
        }),
        { status: 200 },
      );
    }
    if (url.pathname === "/games") {
      return new Response(
        JSON.stringify({
          errors: [],
          response: games.map((game, index) => ({
            game: {
              id: 20_000 + index,
              stage: "Regular Season",
              week: `Week ${game.week}`,
              date: { timestamp: game.scheduledKickoffMs / 1_000 },
              status: { short: "NS", long: "Not Started" },
            },
            league: { id: 1, season: String(seasonYear) },
            teams: {
              home: {
                id:
                  input.conflictingGameTeamId && index === 0
                    ? 10_000 +
                      canonicalTeams.findIndex(
                        (team) =>
                          team.abbreviation !==
                          game.homeTeamAbbreviation,
                      )
                    : 10_000 +
                      canonicalTeams.findIndex(
                        (team) =>
                          team.abbreviation ===
                          game.homeTeamAbbreviation,
                      ),
                name: canonicalTeams.find(
                  (team) =>
                    team.abbreviation ===
                    game.homeTeamAbbreviation,
                )!.name,
              },
              away: {
                id:
                  10_000 +
                  canonicalTeams.findIndex(
                    (team) =>
                      team.abbreviation ===
                      game.awayTeamAbbreviation,
                  ),
                name: canonicalTeams.find(
                  (team) =>
                    team.abbreviation ===
                    game.awayTeamAbbreviation,
                )!.name,
              },
            },
            scores: {
              home: { total: game.homeScore },
              away: { total: game.awayScore },
            },
          })),
        }),
        { status: 200 },
      );
    }
    return new Response("not found", { status: 404 });
  };
}

describe("staged API-Sports Season Bootstrap", () => {
  const previousOperator =
    process.env.PRODUCTION_OPERATOR_CLERK_USER_ID;
  const previousProvider = process.env.SPORTS_DATA_PROVIDER;
  const previousApiKey = process.env.API_SPORTS_KEY;
  const previousDeploymentKind = process.env.DEPLOYMENT_KIND;

  beforeEach(() => {
    process.env.PRODUCTION_OPERATOR_CLERK_USER_ID = "operator";
    process.env.SPORTS_DATA_PROVIDER = "api-sports";
    process.env.API_SPORTS_KEY = "sanitized-test-key";
    process.env.DEPLOYMENT_KIND = "development";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (previousOperator === undefined) {
      delete process.env.PRODUCTION_OPERATOR_CLERK_USER_ID;
    } else {
      process.env.PRODUCTION_OPERATOR_CLERK_USER_ID =
        previousOperator;
    }
    if (previousProvider === undefined) {
      delete process.env.SPORTS_DATA_PROVIDER;
    } else {
      process.env.SPORTS_DATA_PROVIDER = previousProvider;
    }
    if (previousApiKey === undefined) {
      delete process.env.API_SPORTS_KEY;
    } else {
      process.env.API_SPORTS_KEY = previousApiKey;
    }
    if (previousDeploymentKind === undefined) {
      delete process.env.DEPLOYMENT_KIND;
    } else {
      process.env.DEPLOYMENT_KIND = previousDeploymentKind;
    }
  });

  it("persists a valid parent/child snapshot without activating or changing active domain data", async () => {
    vi.stubGlobal("fetch", apiSportsFetch({}));
    const t = convexTest(schema, modules);
    const active = await t.run(async (ctx) => {
      const activeSeasonId = await ctx.db.insert("poolSeasons", {
        label: "2025",
        year: 2025,
        status: "available",
        usableStartWeek: 1,
        bootstrappedAtMs: nowMs,
      });
      const participantId = await ctx.db.insert("participants", {
        tokenIdentifier: "https://auth.example.test|operator",
        clerkUserId: "operator",
        displayName: "Fixture Owner",
        emailVerified: true,
        phoneVerified: true,
        ageConfirmed: true,
        suspended: false,
      });
      const homeTeamId = await ctx.db.insert("nflTeams", {
        stableKey: "fixture-home",
        name: "Fixture Home",
        abbreviation: "FHM",
      });
      const awayTeamId = await ctx.db.insert("nflTeams", {
        stableKey: "fixture-away",
        name: "Fixture Away",
        abbreviation: "FAW",
      });
      const gameId = await ctx.db.insert("nflGames", {
        stableKey: "fixture-game",
        seasonId: activeSeasonId,
        seasonLabel: "2025",
        week: 1,
        homeTeamId,
        awayTeamId,
        scheduledKickoffMs: nowMs + 1_000,
        lifecycle: "scheduled",
        homeScore: null,
        awayScore: null,
      });
      const poolId = await ctx.db.insert("pools", {
        name: "Fixture Pool",
        type: "confidence",
        seasonId: activeSeasonId,
        startWeek: 1,
        pickLockMode: "gameKickoff",
        status: "active",
        rulesFrozen: true,
        ownerParticipantId: participantId,
        createdAtMs: nowMs,
      });
      const membershipId = await ctx.db.insert("poolMemberships", {
        poolId,
        participantId,
        role: "owner",
        status: "active",
      });
      const entryId = await ctx.db.insert("poolEntries", {
        poolId,
        participantId,
        membershipId,
        entryNumber: 1,
        status: "active",
        createdAtMs: nowMs,
      });
      await ctx.db.insert("confidencePickSheets", {
        poolId,
        week: 1,
        gameIds: [gameId],
        scaleMax: 1,
        tiebreakerGameId: gameId,
        frozenAtMs: nowMs,
      });
      const pickSetId = await ctx.db.insert("confidencePickSets", {
        poolId,
        participantId,
        entryId,
        week: 1,
        origin: "authored",
        tiebreakerPrediction: 21,
        tiebreakerLocked: true,
        updatedAtMs: nowMs,
      });
      await ctx.db.insert("confidencePicks", {
        poolId,
        participantId,
        entryId,
        week: 1,
        pickSetId,
        gameId,
        pickedTeamId: homeTeamId,
        confidenceValue: 1,
        locked: true,
        lockedAtMs: nowMs,
        provenance: "authored",
        updatedAtMs: nowMs,
      });
      const revisionId = await ctx.db.insert("scoringRevisions", {
        poolId,
        week: 1,
        kind: "confidence",
        revisionNumber: 1,
        fingerprint: "fixture",
        publishedAtMs: nowMs,
        status: "published",
      });
      await ctx.db.insert("weeklyStandings", {
        poolId,
        participantId,
        entryId,
        week: 1,
        points: 1,
        possibleRemainingPoints: 0,
        rank: 1,
        correctPickCount: 1,
        tiebreakerUsable: false,
        revisionId,
        updatedAtMs: nowMs,
      });
      await ctx.db.insert("seasonStandings", {
        poolId,
        participantId,
        entryId,
        eligibility: "alive",
        seasonPoints: 1,
        seasonRank: 1,
        revisionId,
        updatedAtMs: nowMs,
      });
      return {
        poolId,
        entryId,
      };
    });

    const asOperator = t.withIdentity(identity("operator"));
    const readActiveDomain = async () => ({
      availableSeason: await asOperator.query(
        api.pools.listAvailableStartWeeks,
        {},
      ),
      teams: await asOperator.query(
        api.sync.listNflTeamSummaries,
        {},
      ),
      pools: await asOperator.query(api.participants.myPools, {}),
      poolBoard: await asOperator.query(api.pools.getWeekBoard, {
        poolId: active.poolId,
        week: 1,
        entryId: active.entryId,
      }),
      standings: await asOperator.query(
        api.confidenceScoring.getConfidenceStandings,
        { poolId: active.poolId, week: 1 },
      ),
    });
    const beforeStaging = await readActiveDomain();

    const result = await asOperator.action(
      api.bootstrap.stageSeasonBootstrap,
      { seasonYear },
    );

    expect(result.report.valid).toBe(true);
    expect(result.report.activationEligible).toBe(true);
    expect(result.report.counts).toMatchObject({
      teams: 32,
      games: 272,
      weeks: 18,
      failures: 0,
    });

    const persisted = await asOperator.query(
      api.bootstrap.getSeasonBootstrapStageReport,
      { stageId: result.stageId },
    );

    expect(persisted).toMatchObject({
      seasonYear,
      validationStatus: "valid",
      activationEligible: true,
      counts: {
        teams: 32,
        games: 272,
        teamAliases: 32,
        gameAliases: 272,
        failures: 0,
        storedFailures: 0,
      },
      failures: [],
    });
    await expect(
      t
        .withIdentity(identity("participant"))
        .query(api.bootstrap.getSeasonBootstrapStageReport, {
          stageId: result.stageId,
        }),
    ).rejects.toThrow(/Production Operator required/);

    expect(await readActiveDomain()).toEqual(beforeStaging);
    expect(beforeStaging).toMatchObject({
      availableSeason: {
        seasonId: expect.any(String),
        seasonLabel: "2025",
      },
      teams: expect.arrayContaining([
        expect.objectContaining({ abbreviation: "FHM" }),
        expect.objectContaining({ abbreviation: "FAW" }),
      ]),
      pools: {
        memberships: [
          expect.objectContaining({ name: "Fixture Pool" }),
        ],
      },
      poolBoard: {
        pool: { name: "Fixture Pool" },
        slate: [
          expect.objectContaining({
            homeTeam: expect.objectContaining({
              abbreviation: "FHM",
            }),
            awayTeam: expect.objectContaining({
              abbreviation: "FAW",
            }),
          }),
        ],
        myConfidencePickSet: {
          picks: [
            expect.objectContaining({
              confidenceValue: 1,
              provenance: "authored",
            }),
          ],
        },
      },
      standings: {
        weekly: {
          rows: [
            expect.objectContaining({ points: 1, rank: 1 }),
          ],
        },
        season: {
          rows: [
            expect.objectContaining({ seasonPoints: 1, seasonRank: 1 }),
          ],
        },
      },
    });
  });

  it("persists actionable failures and makes an invalid snapshot ineligible for activation", async () => {
    const teamRows = completeTeams().slice(0, 31).map((team, index) => ({
      id: 10_000 + index,
      name: team.name,
      code: team.abbreviation,
      logo: team.logoUrl,
    }));
    vi.stubGlobal("fetch", apiSportsFetch({ teamRows }));
    const t = convexTest(schema, modules);
    const asOperator = t.withIdentity(identity("operator"));
    const result = await asOperator.action(
      api.bootstrap.stageSeasonBootstrap,
      { seasonYear },
    );

    expect(result.report.valid).toBe(false);
    expect(result.report.activationEligible).toBe(false);
    expect(result.report.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "team_count_mismatch" }),
        expect.objectContaining({
          code: "missing_team_identity",
          entityKey: "WAS",
        }),
      ]),
    );

    const persisted = await asOperator.query(
      api.bootstrap.getSeasonBootstrapStageReport,
      { stageId: result.stageId },
    );
    expect(persisted).toMatchObject({
      validationStatus: "invalid",
      activationEligible: false,
      counts: {
        failures: result.report.failures.length,
        storedFailures: result.report.failures.length,
      },
    });
    expect(persisted?.failures).toHaveLength(
      result.report.failures.length,
    );
  });

  it("requires Production Operator authority before the public action fetches", async () => {
    const t = convexTest(schema, modules);
    const asParticipant = t.withIdentity(identity("participant"));

    await expect(
      asParticipant.action(api.bootstrap.stageSeasonBootstrap, {
        seasonYear,
      }),
    ).rejects.toThrow(/Production Operator required/);
  });

  it("fetches through the configured provider-neutral adapter at the action edge", async () => {
    const requestedPaths: string[] = [];
    const fetch = apiSportsFetch({});
    vi.stubGlobal(
      "fetch",
      async (input: string | URL | Request) => {
        const url = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input
              : input.url,
        );
        requestedPaths.push(url.pathname);
        return fetch(input);
      },
    );

    const t = convexTest(schema, modules);
    const asOperator = t.withIdentity(identity("operator"));
    const result = await asOperator.action(
      api.bootstrap.stageSeasonBootstrap,
      { seasonYear },
    );

    expect([...requestedPaths].sort()).toEqual(["/games", "/teams"]);
    expect(result.report).toMatchObject({
      valid: true,
      activationEligible: true,
      counts: { teams: 32, games: 272, failures: 0 },
    });
  });

  it("stages incomplete and duplicate provider candidates as actionable invalid reports", async () => {
    const canonicalRows = completeTeams().map((team, index) => ({
      id: 10_000 + index,
      name: team.name,
      code: team.abbreviation,
      logo: team.logoUrl,
    }));

    for (const scenario of [
      {
        rows: canonicalRows.slice(0, 31),
        teamCount: 31,
        code: "missing_team_identity",
      },
      {
        rows: [...canonicalRows, canonicalRows[0]!],
        teamCount: 33,
        code: "duplicate_team_identity",
      },
    ] as const) {
      vi.stubGlobal(
        "fetch",
        apiSportsFetch({ teamRows: scenario.rows }),
      );
      const t = convexTest(schema, modules);
      const asOperator = t.withIdentity(identity("operator"));
      const result = await asOperator.action(
        api.bootstrap.stageSeasonBootstrap,
        { seasonYear },
      );

      expect(result.report).toMatchObject({
        valid: false,
        activationEligible: false,
        counts: { teams: scenario.teamCount },
      });
      expect(result.report.failures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "team_count_mismatch" }),
          expect.objectContaining({ code: scenario.code }),
        ]),
      );
      const stage = await asOperator.query(
        api.bootstrap.getSeasonBootstrapStageReport,
        { stageId: result.stageId },
      );
      expect(stage).toMatchObject({
        validationStatus: "invalid",
        activationEligible: false,
        counts: { teams: scenario.teamCount },
      });
    }
  });

  it("persists a specific invalid report when provider decoding fails", async () => {
    vi.stubGlobal("fetch", apiSportsFetch({ malformedGames: true }));
    const t = convexTest(schema, modules);
    const asOperator = t.withIdentity(identity("operator"));
    const result = await asOperator.action(
      api.bootstrap.stageSeasonBootstrap,
      { seasonYear },
    );

    expect(result.report).toMatchObject({
      valid: false,
      activationEligible: false,
      counts: { teams: 0, games: 0 },
    });
    expect(result.report.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "provider_fetch_failure",
          entityKey: "api-sports",
          message: expect.stringMatching(
            /response decode failed for \/games/,
          ),
        }),
      ]),
    );
    const stage = await asOperator.query(
      api.bootstrap.getSeasonBootstrapStageReport,
      { stageId: result.stageId },
    );
    expect(stage).toMatchObject({
      validationStatus: "invalid",
      activationEligible: false,
      counts: { failures: result.report.failures.length },
    });
  });

  it("persists a specific invalid report for an unresolvable provider team identity", async () => {
    const rows: Array<{
      id: number;
      name: string;
      code: string | null;
      logo: string | null;
    }> = completeTeams().map((team, index) => ({
      id: 10_000 + index,
      name: team.name,
      code: team.abbreviation,
      logo: team.logoUrl,
    }));
    rows[0] = {
      id: 99_999,
      name: "Unknown Desert Birds",
      code: "PHX",
      logo: "",
    };
    vi.stubGlobal("fetch", apiSportsFetch({ teamRows: rows }));
    const t = convexTest(schema, modules);
    const result = await t
      .withIdentity(identity("operator"))
      .action(api.bootstrap.stageSeasonBootstrap, { seasonYear });

    expect(result.report).toMatchObject({
      valid: false,
      activationEligible: false,
    });
    expect(result.report.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "provider_fetch_failure",
          message: expect.stringMatching(
            /NFL Team 99999 has no approved deterministic alias/,
          ),
        }),
      ]),
    );
  });

  it("rejects a game whose canonical team name conflicts with its provider team ID", async () => {
    vi.stubGlobal(
      "fetch",
      apiSportsFetch({ conflictingGameTeamId: true }),
    );
    const t = convexTest(schema, modules);
    const result = await t
      .withIdentity(identity("operator"))
      .action(api.bootstrap.stageSeasonBootstrap, { seasonYear });

    expect(result.report).toMatchObject({
      valid: false,
      activationEligible: false,
    });
    expect(result.report.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "ambiguous_team_identity",
          entityKey: expect.stringContaining(":home:api-sports:"),
        }),
      ]),
    );
  });

  it("stages an invalid explicit year without issuing a provider request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const t = convexTest(schema, modules);
    const result = await t
      .withIdentity(identity("operator"))
      .action(api.bootstrap.stageSeasonBootstrap, { seasonYear: 0 });

    expect(fetch).not.toHaveBeenCalled();
    expect(result.report).toMatchObject({
      valid: false,
      activationEligible: false,
    });
    expect(result.report.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_season_year" }),
      ]),
    );
  });

  it("fails closed before fetch when provider configuration is missing", async () => {
    delete process.env.SPORTS_DATA_PROVIDER;
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const t = convexTest(schema, modules);
    const asOperator = t.withIdentity(identity("operator"));
    const result = await asOperator.action(
      api.bootstrap.stageSeasonBootstrap,
      { seasonYear },
    );

    expect(fetch).not.toHaveBeenCalled();
    expect(result.report).toMatchObject({
      valid: false,
      activationEligible: false,
      failures: expect.arrayContaining([
        expect.objectContaining({
          code: "provider_configuration_failure",
          entityKey: "api-sports",
          message: expect.stringMatching(
            /must select one supported provider/,
          ),
        }),
      ]),
    });
    const persisted = await asOperator.query(
      api.bootstrap.getSeasonBootstrapStageReport,
      { stageId: result.stageId },
    );
    expect(persisted).toMatchObject({
      validationStatus: "invalid",
      activationEligible: false,
      counts: {
        teams: 0,
        games: 0,
        failures: result.report.failures.length,
        storedFailures: result.report.failures.length,
      },
      failures: expect.arrayContaining([
        expect.objectContaining({
          code: "provider_configuration_failure",
          entityKey: "api-sports",
        }),
      ]),
    });
  });

  it("persists provider transport failure without exposing an activatable snapshot", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("synthetic network failure");
    });
    const t = convexTest(schema, modules);
    const result = await t
      .withIdentity(identity("operator"))
      .action(api.bootstrap.stageSeasonBootstrap, { seasonYear });

    expect(result.report).toMatchObject({
      valid: false,
      activationEligible: false,
    });
    expect(result.report.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "provider_fetch_failure",
          message: expect.stringMatching(
            /API-Sports transport failed/,
          ),
        }),
      ]),
    );
  });

  it("persists only a bounded failure report when provider output exceeds staging limits", async () => {
    const oversizedGames = [
      ...completeGames(),
      ...completeGames().slice(0, 29),
    ];
    vi.stubGlobal(
      "fetch",
      apiSportsFetch({ games: oversizedGames }),
    );
    const t = convexTest(schema, modules);
    const asOperator = t.withIdentity(identity("operator"));
    const result = await asOperator.action(
      api.bootstrap.stageSeasonBootstrap,
      { seasonYear },
    );

    expect(result.report).toMatchObject({
      valid: false,
      activationEligible: false,
      counts: { teams: 32, games: 301 },
    });
    expect(result.report.failures).toContainEqual(
      expect.objectContaining({
        code: "provider_snapshot_too_large",
        message: expect.stringMatching(/received 32 teams, 301 games/),
      }),
    );
    const persisted = await asOperator.query(
      api.bootstrap.getSeasonBootstrapStageReport,
      { stageId: result.stageId },
    );
    expect(persisted).toMatchObject({
      validationStatus: "invalid",
      activationEligible: false,
      counts: { teams: 32, games: 301, storedFailures: 1 },
    });
  });

  it("bounds persisted validation failure rows for corrupt in-range snapshots", async () => {
    const t = convexTest(schema, modules);
    const asOperator = t.withIdentity(identity("operator"));
    const corruptGames = stagedGames(
      completeGames().map((game) => ({ ...game, week: 19 })),
    );
    const result = await t.mutation(
      internal.bootstrap.persistSeasonBootstrapStage,
      {
        seasonYear,
        sourceProvider: "api-sports",
        teams: stagedTeams(),
        games: corruptGames,
        actorTokenIdentifier: "https://auth.example.test|operator",
        actorClerkUserId: "operator",
        nowMs,
      },
    );

    expect(result.report).toMatchObject({
      valid: false,
      activationEligible: false,
      failuresTruncated: true,
    });
    expect(result.report.counts.failures).toBeGreaterThan(
      result.report.failures.length,
    );
    expect(result.report.failures).toHaveLength(200);
    expect(result.report.failures.at(-1)).toMatchObject({
      code: "validation_report_truncated",
    });
    const persisted = await asOperator.query(
      api.bootstrap.getSeasonBootstrapStageReport,
      { stageId: result.stageId },
    );
    expect(persisted).toMatchObject({
      counts: {
        failures: result.report.counts.failures,
        storedFailures: 200,
      },
      failuresTruncated: true,
    });
    expect(persisted?.failures).toHaveLength(200);
  });
});

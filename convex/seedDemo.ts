/**
 * Dev-only browse-ready demo seeder — no provider calls.
 *
 * Narrative clock: weeks 1–3 are past/locked (1–2 scored), week 4 is the open
 * board (TNF started; rest of slate still pickable), weeks 5–6 stay fully
 * future for Create Pool start-week options.
 *
 *   bunx convex run seedDemo:seedDemoWorld '{"ownerClerkUserId":"user_…"}'
 *
 * Requires the owner to have signed in once (participants row by clerkUserId).
 */

import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { resolveDeploymentKind } from "./lib/syncGate";
import { nflGameStableKey } from "./providers/sportsData/identity";
import {
  CANONICAL_NFL_TEAM_LIST,
  type CanonicalNflTeamAbbreviation,
  type NflTeamStableKey,
} from "./providers/sportsData/catalog";
import {
  attachNflGameAlias,
  attachNflTeamAlias,
  persistReconciledNflGame,
  reconcileStoredNflGame,
  reconcileStoredNflTeam,
} from "./providers/sportsData/identityStore";

const SEED_POOL_PREFIX = "Seed · ";
const SEED_TEAM_PREFIX = "seed:team:";
const SEED_GAME_PREFIX = "seed:game:";
const SEED_TOKEN_PREFIX = "seed|";
const SEED_CLERK_PREFIX = "seed_";
const DEFAULT_OWNER_CLERK_USER_ID = "user_3GYF9xQXL66xX5aTpVwIvUj4bok";
const SEASON_LABEL = "2025";
/** Demo slate: weeks before this are past/locked; this week is the open board. */
const OPEN_WEEK = 4;
/** Extra future weeks so Create Pool still has Available Start Weeks. */
const SLATE_END_WEEK = 6;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

const FAKE_PEOPLE: ReadonlyArray<{ slug: string; displayName: string }> = [
  { slug: "alex", displayName: "Alex Rivera" },
  { slug: "blake", displayName: "Blake Chen" },
  { slug: "casey", displayName: "Casey Okonkwo" },
  { slug: "dana", displayName: "Dana Patel" },
  { slug: "ellis", displayName: "Ellis Nguyen" },
  { slug: "finley", displayName: "Finley Brooks" },
  { slug: "gray", displayName: "Gray Morales" },
  { slug: "harper", displayName: "Harper Singh" },
  { slug: "indie", displayName: "Indie Walsh" },
  { slug: "jordan", displayName: "Jordan Lee" },
  { slug: "kai", displayName: "Kai Thompson" },
  { slug: "logan", displayName: "Logan Reyes" },
  { slug: "morgan", displayName: "Morgan Kim" },
  { slug: "noah", displayName: "Noah Bennett" },
  { slug: "owen", displayName: "Owen Castillo" },
  { slug: "parker", displayName: "Parker Dunn" },
  { slug: "quinn", displayName: "Quinn Alvarez" },
  { slug: "riley", displayName: "Riley Foster" },
  { slug: "sage", displayName: "Sage Hoffman" },
  { slug: "taylor", displayName: "Taylor Brooks" },
];

const POOL_BLUEPRINTS: ReadonlyArray<{
  name: string;
  type: "survivor" | "confidence";
  pickLockMode: "gameKickoff" | "weeklyCutoff";
}> = [
  { name: "Office Survivor", type: "survivor", pickLockMode: "gameKickoff" },
  { name: "Sunday Confidence", type: "confidence", pickLockMode: "gameKickoff" },
  { name: "Family Survivor", type: "survivor", pickLockMode: "weeklyCutoff" },
  { name: "Bar League Confidence", type: "confidence", pickLockMode: "weeklyCutoff" },
  { name: "Alumni Survivor", type: "survivor", pickLockMode: "gameKickoff" },
  { name: "Slack Confidence", type: "confidence", pickLockMode: "gameKickoff" },
  { name: "Rivalry Survivor", type: "survivor", pickLockMode: "weeklyCutoff" },
  { name: "Draft Night Confidence", type: "confidence", pickLockMode: "gameKickoff" },
  { name: "Neighbors Survivor", type: "survivor", pickLockMode: "gameKickoff" },
  { name: "Podcast Confidence", type: "confidence", pickLockMode: "weeklyCutoff" },
];

function assertDevDeployment(): void {
  const kind = resolveDeploymentKind(
    process.env as Record<string, string | undefined>,
  );
  if (kind === "production") {
    throw new Error("seedDemoWorld is Dev-only — refused on production");
  }
}

/** Deterministic shuffle for stable seed memberships across re-runs. */
function rotateSlice<T>(items: ReadonlyArray<T>, offset: number, count: number): T[] {
  const n = items.length;
  if (n === 0 || count <= 0) return [];
  const out: T[] = [];
  for (let i = 0; i < Math.min(count, n); i++) {
    out.push(items[(offset + i) % n]!);
  }
  return out;
}

type SeedResult = {
  seasonId: Id<"poolSeasons">;
  ownerParticipantId: Id<"participants">;
  teamCount: number;
  gameCount: number;
  fakeUserCount: number;
  poolCount: number;
  membershipCount: number;
  survivorPickCount: number;
  reset: boolean;
};

/**
 * Browse-ready Dev seed: Available Season, NFL slate, fake members, pools you own.
 *
 *   bunx convex run seedDemo:seedDemoWorld '{"ownerClerkUserId":"user_3GYF9xQXL66xX5aTpVwIvUj4bok"}'
 */
export const seedDemoWorld = internalMutation({
  args: {
    ownerClerkUserId: v.optional(v.string()),
    reset: v.optional(v.boolean()),
    poolCount: v.optional(v.number()),
    fakeUserCount: v.optional(v.number()),
    nowMs: v.optional(v.number()),
    includeApiSportsGameAliases: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<SeedResult> => {
    assertDevDeployment();

    const ownerClerkUserId =
      args.ownerClerkUserId?.trim() || DEFAULT_OWNER_CLERK_USER_ID;
    const reset = args.reset !== false;
    const poolCount = Math.max(
      1,
      Math.min(args.poolCount ?? POOL_BLUEPRINTS.length, POOL_BLUEPRINTS.length),
    );
    const fakeUserCount = Math.max(
      1,
      Math.min(args.fakeUserCount ?? FAKE_PEOPLE.length, FAKE_PEOPLE.length),
    );
    const nowMs = args.nowMs ?? Date.now();

    const owner = await ctx.db
      .query("participants")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", ownerClerkUserId))
      .unique();
    if (owner === null) {
      throw new Error(
        `No participant for clerkUserId=${ownerClerkUserId}. Sign into the app once, then re-run seed.`,
      );
    }

    if (reset) {
      await clearPriorSeed(ctx);
    }

    let season = await ctx.db
      .query("poolSeasons")
      .withIndex("by_label", (q) => q.eq("label", SEASON_LABEL))
      .unique();
    if (season === null) {
      const seasonId = await ctx.db.insert("poolSeasons", {
        label: SEASON_LABEL,
        year: 2025,
        status: "available",
        usableStartWeek: 1,
        bootstrappedAtMs: nowMs,
      });
      season = await ctx.db.get(seasonId);
    } else {
      await ctx.db.patch(season._id, {
        status: "available",
        usableStartWeek: 1,
        bootstrappedAtMs: nowMs,
      });
      season = await ctx.db.get(season._id);
    }
    if (season === null) {
      throw new Error("Failed to upsert Pool Season");
    }

    const teamIds: Id<"nflTeams">[] = [];
    const abbrToIdentity = new Map<
      CanonicalNflTeamAbbreviation,
      { id: Id<"nflTeams">; stableKey: NflTeamStableKey }
    >();
    for (const team of CANONICAL_NFL_TEAM_LIST) {
      const alias = {
        provider: "in-memory",
        externalId: `seed-team-${team.abbreviation}`,
      } as const;
      const reconciliation = await reconcileStoredNflTeam(ctx, {
        alias,
        stableKey: team.stableKey,
      });
      const fields = {
        stableKey: team.stableKey,
        name: team.name,
        abbreviation: team.abbreviation,
        logoUrl: team.logoUrl,
      };
      let id: Id<"nflTeams">;
      if (reconciliation.kind === "resolved") {
        id = reconciliation.nflTeamId;
        await ctx.db.replace(id, fields);
      } else {
        id = await ctx.db.insert("nflTeams", fields);
      }
      await attachNflTeamAlias(ctx, {
        nflTeamId: id,
        alias,
        observedAtMs: nowMs,
      });
      teamIds.push(id);
      abbrToIdentity.set(team.abbreviation, {
        id,
        stableKey: team.stableKey,
      });
    }

    let gameCount = 0;
    for (let week = 1; week <= SLATE_END_WEEK; week++) {
      // Rotate pairings so weeks aren't identical.
      const order = CANONICAL_NFL_TEAM_LIST.map(
        (_team, index) =>
          CANONICAL_NFL_TEAM_LIST[
            (index + week) % CANONICAL_NFL_TEAM_LIST.length
          ]!,
      );
      const pastWeek = week < OPEN_WEEK;
      const upcomingWeek = week > OPEN_WEEK;
      for (let i = 0; i + 1 < order.length; i += 2) {
        const home = order[i]!;
        const away = order[i + 1]!;
        const homeTeam = abbrToIdentity.get(home.abbreviation);
        const awayTeam = abbrToIdentity.get(away.abbreviation);
        if (!homeTeam || !awayTeam) continue;

        const slot = i / 2;
        // Past weeks: entire slate finished days/weeks ago so kickoff locks hold.
        // Open week: first game already kicked off (boardWeek advances) while the
        // rest of the slate stays in the future so picks remain editable.
        // Later weeks: fully future so Create Pool still has start-week options.
        const scheduledKickoffMs = pastWeek
          ? nowMs - (OPEN_WEEK - week) * WEEK_MS - 2 * DAY_MS + slot * HOUR_MS
          : upcomingWeek
            ? nowMs + (week - OPEN_WEEK) * WEEK_MS + DAY_MS + slot * HOUR_MS
            : slot === 0
              ? nowMs - 2 * HOUR_MS
              : nowMs + DAY_MS + (slot - 1) * 3 * HOUR_MS;
        const kickoffReached = scheduledKickoffMs <= nowMs;
        const homeScore = pastWeek ? 21 + (slot % 14) : null;
        const awayScore = pastWeek ? 14 + (slot % 11) : null;

        const stableKey = nflGameStableKey({
          seasonYear: Number(SEASON_LABEL),
          week,
          awayTeamAbbreviation: away.abbreviation,
          homeTeamAbbreviation: home.abbreviation,
        });
        const externalId =
          `seed_evt_w${week}_${away.abbreviation}_${home.abbreviation}`;
        const alias = {
          provider: "in-memory",
          externalId,
        } as const;
        const reconciliation = await reconcileStoredNflGame(ctx, {
          alias,
          seasonId: season._id,
          week,
          homeTeamId: homeTeam.id,
          awayTeamId: awayTeam.id,
          homeTeamStableKey: homeTeam.stableKey,
          awayTeamStableKey: awayTeam.stableKey,
          scheduledKickoffMs,
        });
        const fields = {
          stableKey,
          seasonId: season._id,
          seasonLabel: SEASON_LABEL,
          week,
          homeTeamId: homeTeam.id,
          awayTeamId: awayTeam.id,
          scheduledKickoffMs,
          lifecycle: pastWeek
            ? ("terminal" as const)
            : kickoffReached
              ? ("in_progress" as const)
              : ("scheduled" as const),
          homeScore,
          awayScore,
          ...(kickoffReached
            ? { kickoffLockReachedAtMs: scheduledKickoffMs }
            : {}),
          ...(pastWeek && homeScore !== null && awayScore !== null
            ? {
                resultAuthority: "verified" as const,
                verifiedResult: {
                  homeScore,
                  awayScore,
                  verifiedAtMs: scheduledKickoffMs + 3 * HOUR_MS,
                  status: "FT" as const,
                },
              }
            : { resultAuthority: "none" as const }),
        };
        const gameId = await persistReconciledNflGame(ctx, {
          reconciliation,
          fields,
          alias,
          observedAtMs: nowMs,
        });
        if (args.includeApiSportsGameAliases === true) {
          await attachNflGameAlias(ctx, {
            nflGameId: gameId,
            alias: {
              provider: "api-sports",
              externalId: `e2e_w${week}_${away.abbreviation}_${home.abbreviation}`,
            },
            observedAtMs: nowMs,
          });
        }
        gameCount += 1;
      }
    }

    const people = FAKE_PEOPLE.slice(0, fakeUserCount);
    const fakeIds: Id<"participants">[] = [];
    for (const person of people) {
      const tokenIdentifier = `${SEED_TOKEN_PREFIX}${person.slug}`;
      const clerkUserId = `${SEED_CLERK_PREFIX}${person.slug}`;
      const existing = await ctx.db
        .query("participants")
        .withIndex("by_tokenIdentifier", (q) =>
          q.eq("tokenIdentifier", tokenIdentifier),
        )
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, {
          displayName: person.displayName,
          email: `${person.slug}@seed.invalid`,
          phone: `+1555${String(fakeIds.length).padStart(7, "0")}`,
          emailVerified: true,
          phoneVerified: true,
          ageConfirmed: true,
          suspended: false,
        });
        fakeIds.push(existing._id);
      } else {
        const id = await ctx.db.insert("participants", {
          tokenIdentifier,
          clerkUserId,
          displayName: person.displayName,
          email: `${person.slug}@seed.invalid`,
          phone: `+1555${String(fakeIds.length).padStart(7, "0")}`,
          emailVerified: true,
          phoneVerified: true,
          ageConfirmed: true,
          suspended: false,
        });
        fakeIds.push(id);
      }
    }

    const blueprints = POOL_BLUEPRINTS.slice(0, poolCount);
    let membershipCount = 0;
    let survivorPickCount = 0;
    const poolIds: Id<"pools">[] = [];
    for (let i = 0; i < blueprints.length; i++) {
      const bp = blueprints[i]!;
      const poolName = `${SEED_POOL_PREFIX}${bp.name}`;
      const poolId = await ctx.db.insert("pools", {
        name: poolName,
        type: bp.type,
        seasonId: season._id,
        startWeek: 1,
        pickLockMode: bp.pickLockMode,
        status: "active",
        rulesFrozen: false,
        ownerParticipantId: owner._id,
        createdAtMs: nowMs + i,
      });
      poolIds.push(poolId);

      const ownerMembershipId = await ctx.db.insert("poolMemberships", {
        poolId,
        participantId: owner._id,
        role: "owner",
        status: "active",
      });
      membershipCount += 1;
      const ownerEntryId = await ctx.db.insert("poolEntries", {
        poolId,
        participantId: owner._id,
        membershipId: ownerMembershipId,
        entryNumber: 1,
        status: "active",
        createdAtMs: nowMs + i,
      });

      const memberCount = 6 + (i % 7); // 6–12
      const members = rotateSlice(fakeIds, i * 3, memberCount);
      const entryIds: Id<"poolEntries">[] = [ownerEntryId];
      const allMemberIds: Id<"participants">[] = [owner._id, ...members];
      for (let m = 0; m < members.length; m++) {
        const role = m < 2 ? ("admin" as const) : ("member" as const);
        const membershipId = await ctx.db.insert("poolMemberships", {
          poolId,
          participantId: members[m]!,
          role,
          status: "active",
        });
        membershipCount += 1;
        const entryId = await ctx.db.insert("poolEntries", {
          poolId,
          participantId: members[m]!,
          membershipId,
          entryNumber: 1,
          status: "active",
          createdAtMs: nowMs + i,
        });
        entryIds.push(entryId);
      }

      if (bp.type === "survivor") {
        survivorPickCount += await seedSurvivorStandingsHistory(ctx, {
          poolId,
          memberIds: allMemberIds,
          entryIds,
          teamIds,
          nowMs,
        });
      }
    }

    await ctx.db.insert("operatorAuditEvents", {
      action: "seed_demo_world",
      actorTokenIdentifier: `cli|${ownerClerkUserId}`,
      actorClerkUserId: ownerClerkUserId,
      atMs: nowMs,
      detailsJson: JSON.stringify({
        seasonLabel: SEASON_LABEL,
        teamCount: teamIds.length,
        gameCount,
        fakeUserCount: fakeIds.length,
        poolCount: poolIds.length,
        membershipCount,
        survivorPickCount,
        reset,
      }),
    });

    return {
      seasonId: season._id,
      ownerParticipantId: owner._id,
      teamCount: teamIds.length,
      gameCount,
      fakeUserCount: fakeIds.length,
      poolCount: poolIds.length,
      membershipCount,
      survivorPickCount,
      reset,
    };
  },
});

/**
 * Demo-only history so Standings shows Splashsports-style week pick cells.
 * Weeks 1–2 locked + scored; week 3 locked pending; open week unlocked (hidden).
 */
async function seedSurvivorStandingsHistory(
  ctx: MutationCtx,
  args: {
    poolId: Id<"pools">;
    memberIds: Id<"participants">[];
    entryIds: Id<"poolEntries">[];
    teamIds: Id<"nflTeams">[];
    nowMs: number;
  },
): Promise<number> {
  let pickCount = 0;
  const eliminated = new Set<string>();
  const lastScoredWeek = OPEN_WEEK - 2;
  const lastLockedWeek = OPEN_WEEK - 1;

  for (let week = 1; week <= OPEN_WEEK; week++) {
    const revisionId =
      week <= lastScoredWeek
        ? await ctx.db.insert("scoringRevisions", {
            poolId: args.poolId,
            week,
            kind: "survivor",
            revisionNumber: 1,
            fingerprint: `seed|${args.poolId}|w${week}`,
            publishedAtMs: args.nowMs - (OPEN_WEEK + 1 - week) * DAY_MS,
            status: "published",
          })
        : null;

    if (week <= lastScoredWeek) {
      await ctx.db.insert("poolWeeks", {
        poolId: args.poolId,
        week,
        settled: true,
        currentScoringRevisionId: revisionId ?? undefined,
        currentRevisionNumber: 1,
        updatedAtMs: args.nowMs,
      });
    }

    for (let i = 0; i < args.memberIds.length; i++) {
      const participantId = args.memberIds[i]!;
      const entryId = args.entryIds[i]!;
      if (eliminated.has(entryId)) continue;

      const teamId = args.teamIds[(i + week * 3) % args.teamIds.length]!;
      const locked = week <= lastLockedWeek;
      const pickId = await ctx.db.insert("survivorPicks", {
        poolId: args.poolId,
        participantId,
        entryId,
        week,
        nflTeamId: teamId,
        locked,
        lockedAtMs: locked
          ? args.nowMs - (OPEN_WEEK + 1 - week) * DAY_MS
          : undefined,
        provenance: "authored",
        provisional: false,
        updatedAtMs: args.nowMs,
      });
      pickCount += 1;

      await ctx.db.insert("survivorTeamReservations", {
        poolId: args.poolId,
        participantId,
        entryId,
        nflTeamId: teamId,
        week,
        released: false,
        updatedAtMs: args.nowMs,
      });

      if (week <= lastScoredWeek && revisionId) {
        // Eliminate ~1/3 of the field each scored week so the grid has red cells.
        const loses = (i + week) % 3 === 0 && i > 0;
        const outcome = loses ? ("loss" as const) : ("win" as const);
        await ctx.db.insert("survivorPickOutcomes", {
          poolId: args.poolId,
          participantId,
          entryId,
          week,
          pickId,
          outcome,
          revisionId,
          updatedAtMs: args.nowMs,
        });
        if (loses) {
          eliminated.add(entryId);
          await ctx.db.insert("seasonStandings", {
            poolId: args.poolId,
            participantId,
            entryId,
            eligibility: "eliminated",
            eliminatedWeek: week,
            eliminationReason: "loss",
            seasonPoints: 0,
            updatedAtMs: args.nowMs,
          });
        }
      }
    }
  }

  for (let i = 0; i < args.memberIds.length; i++) {
    const participantId = args.memberIds[i]!;
    const entryId = args.entryIds[i]!;
    if (eliminated.has(entryId)) continue;
    const existing = await ctx.db
      .query("seasonStandings")
      .withIndex("by_poolId_and_entryId", (q) =>
        q.eq("poolId", args.poolId).eq("entryId", entryId),
      )
      .unique();
    if (!existing) {
      await ctx.db.insert("seasonStandings", {
        poolId: args.poolId,
        participantId,
        entryId,
        eligibility: "alive",
        seasonPoints: 0,
        updatedAtMs: args.nowMs,
      });
    }
  }

  return pickCount;
}

async function clearPriorSeed(ctx: {
  db: {
    query: MutationCtx["db"]["query"];
    delete: MutationCtx["db"]["delete"];
  };
}): Promise<void> {
  const pools = (await ctx.db.query("pools").collect()).filter((p) =>
    p.name.startsWith(SEED_POOL_PREFIX),
  );
  const seedPoolIds = new Set(pools.map((p) => p._id));

  for (const row of await ctx.db.query("poolEntries").collect()) {
    if (seedPoolIds.has(row.poolId)) await ctx.db.delete(row._id);
  }
  for (const row of await ctx.db.query("poolMemberships").collect()) {
    if (seedPoolIds.has(row.poolId)) await ctx.db.delete(row._id);
  }
  for (const row of await ctx.db.query("survivorPicks").collect()) {
    if (seedPoolIds.has(row.poolId)) await ctx.db.delete(row._id);
  }
  for (const row of await ctx.db.query("survivorPickOutcomes").collect()) {
    if (seedPoolIds.has(row.poolId)) await ctx.db.delete(row._id);
  }
  for (const row of await ctx.db.query("survivorTeamReservations").collect()) {
    if (seedPoolIds.has(row.poolId)) await ctx.db.delete(row._id);
  }
  for (const row of await ctx.db.query("seasonStandings").collect()) {
    if (seedPoolIds.has(row.poolId)) await ctx.db.delete(row._id);
  }
  for (const row of await ctx.db.query("scoringRevisions").collect()) {
    if (seedPoolIds.has(row.poolId)) await ctx.db.delete(row._id);
  }
  for (const row of await ctx.db.query("poolWeeks").collect()) {
    if (seedPoolIds.has(row.poolId)) await ctx.db.delete(row._id);
  }
  for (const row of await ctx.db.query("confidencePickSheets").collect()) {
    if (seedPoolIds.has(row.poolId)) await ctx.db.delete(row._id);
  }
  for (const row of await ctx.db.query("confidencePickSets").collect()) {
    if (seedPoolIds.has(row.poolId)) await ctx.db.delete(row._id);
  }
  for (const row of await ctx.db.query("confidencePicks").collect()) {
    if (seedPoolIds.has(row.poolId)) await ctx.db.delete(row._id);
  }
  for (const row of await ctx.db.query("confidencePickOutcomes").collect()) {
    if (seedPoolIds.has(row.poolId)) await ctx.db.delete(row._id);
  }
  for (const row of await ctx.db.query("weeklyStandings").collect()) {
    if (seedPoolIds.has(row.poolId)) await ctx.db.delete(row._id);
  }

  for (const pool of pools) {
    await ctx.db.delete(pool._id);
  }

  const fakeParticipants = (await ctx.db.query("participants").collect()).filter(
    (p) =>
      p.tokenIdentifier.startsWith(SEED_TOKEN_PREFIX) ||
      p.clerkUserId.startsWith(SEED_CLERK_PREFIX),
  );
  const fakeIds = new Set(fakeParticipants.map((p) => p._id));

  for (const row of await ctx.db.query("poolMemberships").collect()) {
    if (fakeIds.has(row.participantId)) {
      await ctx.db.delete(row._id);
    }
  }
  for (const p of fakeParticipants) {
    await ctx.db.delete(p._id);
  }

  for (const g of await ctx.db.query("nflGames").collect()) {
    if (g.stableKey.startsWith(SEED_GAME_PREFIX)) {
      await ctx.db.delete(g._id);
    }
  }
  for (const t of await ctx.db.query("nflTeams").collect()) {
    if (t.stableKey.startsWith(SEED_TEAM_PREFIX)) {
      await ctx.db.delete(t._id);
    }
  }
}

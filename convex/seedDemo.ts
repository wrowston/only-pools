/**
 * Dev-only browse-ready demo seeder — no SportsDB / provider calls.
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

const SEED_POOL_PREFIX = "Seed · ";
const SEED_TEAM_PREFIX = "seed:team:";
const SEED_GAME_PREFIX = "seed:game:";
const SEED_TOKEN_PREFIX = "seed|";
const SEED_CLERK_PREFIX = "seed_";
const DEFAULT_OWNER_CLERK_USER_ID = "user_3GYF9xQXL66xX5aTpVwIvUj4bok";
const SEASON_LABEL = "2025";

const NFL_TEAMS: ReadonlyArray<{
  abbr: string;
  name: string;
  sportsDbTeamId: string;
}> = [
  { abbr: "ARI", name: "Arizona Cardinals", sportsDbTeamId: "134946" },
  { abbr: "ATL", name: "Atlanta Falcons", sportsDbTeamId: "134921" },
  { abbr: "BAL", name: "Baltimore Ravens", sportsDbTeamId: "134922" },
  { abbr: "BUF", name: "Buffalo Bills", sportsDbTeamId: "134918" },
  { abbr: "CAR", name: "Carolina Panthers", sportsDbTeamId: "134923" },
  { abbr: "CHI", name: "Chicago Bears", sportsDbTeamId: "134924" },
  { abbr: "CIN", name: "Cincinnati Bengals", sportsDbTeamId: "134919" },
  { abbr: "CLE", name: "Cleveland Browns", sportsDbTeamId: "134920" },
  { abbr: "DAL", name: "Dallas Cowboys", sportsDbTeamId: "134925" },
  { abbr: "DEN", name: "Denver Broncos", sportsDbTeamId: "134926" },
  { abbr: "DET", name: "Detroit Lions", sportsDbTeamId: "134939" },
  { abbr: "GB", name: "Green Bay Packers", sportsDbTeamId: "134927" },
  { abbr: "HOU", name: "Houston Texans", sportsDbTeamId: "134928" },
  { abbr: "IND", name: "Indianapolis Colts", sportsDbTeamId: "134929" },
  { abbr: "JAX", name: "Jacksonville Jaguars", sportsDbTeamId: "134930" },
  { abbr: "KC", name: "Kansas City Chiefs", sportsDbTeamId: "134934" },
  { abbr: "LAC", name: "Los Angeles Chargers", sportsDbTeamId: "135908" },
  { abbr: "LAR", name: "Los Angeles Rams", sportsDbTeamId: "134931" },
  { abbr: "LV", name: "Las Vegas Raiders", sportsDbTeamId: "134932" },
  { abbr: "MIA", name: "Miami Dolphins", sportsDbTeamId: "134933" },
  { abbr: "MIN", name: "Minnesota Vikings", sportsDbTeamId: "134935" },
  { abbr: "NE", name: "New England Patriots", sportsDbTeamId: "134936" },
  { abbr: "NO", name: "New Orleans Saints", sportsDbTeamId: "134937" },
  { abbr: "NYG", name: "New York Giants", sportsDbTeamId: "134938" },
  { abbr: "NYJ", name: "New York Jets", sportsDbTeamId: "134940" },
  { abbr: "PHI", name: "Philadelphia Eagles", sportsDbTeamId: "134941" },
  { abbr: "PIT", name: "Pittsburgh Steelers", sportsDbTeamId: "134942" },
  { abbr: "SEA", name: "Seattle Seahawks", sportsDbTeamId: "134943" },
  { abbr: "SF", name: "San Francisco 49ers", sportsDbTeamId: "134944" },
  { abbr: "TB", name: "Tampa Bay Buccaneers", sportsDbTeamId: "134945" },
  { abbr: "TEN", name: "Tennessee Titans", sportsDbTeamId: "134947" },
  { abbr: "WAS", name: "Washington Commanders", sportsDbTeamId: "134948" },
];

/** Live SportsDB badges keep the browse-ready demo visually production-like. */
const NFL_TEAM_LOGO_URLS: Readonly<Partial<Record<string, string>>> = {
  ARI: "https://r2.thesportsdb.com/images/media/team/badge/xvuwtw1420646838.png",
  ATL: "https://r2.thesportsdb.com/images/media/team/badge/rrpvpr1420658174.png",
  BAL: "https://r2.thesportsdb.com/images/media/team/badge/einz3p1546172463.png",
  BUF: "https://r2.thesportsdb.com/images/media/team/badge/6pb37b1515849026.png",
  CAR: "https://r2.thesportsdb.com/images/media/team/badge/xxyvvy1420940478.png",
  CHI: "https://r2.thesportsdb.com/images/media/team/badge/ji22531698678538.png",
  CIN: "https://r2.thesportsdb.com/images/media/team/badge/qqtwwv1420941670.png",
  CLE: "https://r2.thesportsdb.com/images/media/team/badge/squvxy1420942389.png",
  DAL: "https://r2.thesportsdb.com/images/media/team/badge/wrxssu1450018209.png",
  DEN: "https://r2.thesportsdb.com/images/media/team/badge/upsspx1421635647.png",
  DET: "https://r2.thesportsdb.com/images/media/team/badge/lgsgkr1546168257.png",
  GB: "https://r2.thesportsdb.com/images/media/team/badge/rqpwtr1421434717.png",
  HOU: "https://r2.thesportsdb.com/images/media/team/badge/wqyryy1421436627.png",
  IND: "https://r2.thesportsdb.com/images/media/team/badge/wqqvpx1421434058.png",
  JAX: "https://r2.thesportsdb.com/images/media/team/badge/0mrsd41546427902.png",
  KC: "https://r2.thesportsdb.com/images/media/team/badge/936t161515847222.png",
  LAC: "https://r2.thesportsdb.com/images/media/team/badge/vrqanp1687734910.png",
  LAR: "https://r2.thesportsdb.com/images/media/team/badge/8e8v4i1599764614.png",
  LV: "https://r2.thesportsdb.com/images/media/team/badge/xqusqy1421724291.png",
  MIA: "https://r2.thesportsdb.com/images/media/team/badge/trtusv1421435081.png",
  MIN: "https://r2.thesportsdb.com/images/media/team/badge/qstqqr1421609163.png",
  NE: "https://r2.thesportsdb.com/images/media/team/badge/xtwxyt1421431860.png",
  NO: "https://r2.thesportsdb.com/images/media/team/badge/nd46c71537821337.png",
  NYG: "https://r2.thesportsdb.com/images/media/team/badge/vxppup1423669459.png",
  NYJ: "https://r2.thesportsdb.com/images/media/team/badge/hz92od1607953467.png",
  PHI: "https://r2.thesportsdb.com/images/media/team/badge/pnpybf1515852421.png",
  PIT: "https://r2.thesportsdb.com/images/media/team/badge/2975411515853129.png",
  SEA: "https://r2.thesportsdb.com/images/media/team/badge/wwuqyr1421434817.png",
  SF: "https://r2.thesportsdb.com/images/media/team/badge/bqbtg61539537328.png",
  TB: "https://r2.thesportsdb.com/images/media/team/badge/2dfpdl1537820969.png",
  TEN: "https://r2.thesportsdb.com/images/media/team/badge/3td0f41779180767.png",
  WAS: "https://r2.thesportsdb.com/images/media/team/badge/rn0c7v1643826119.png",
};

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

function teamStableKey(abbr: string): string {
  return `${SEED_TEAM_PREFIX}${abbr.toLowerCase()}`;
}

function gameStableKey(week: number, away: string, home: string): string {
  return `${SEED_GAME_PREFIX}${SEASON_LABEL}:w${week}:${away.toLowerCase()}@${home.toLowerCase()}`;
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
    const abbrToId = new Map<string, Id<"nflTeams">>();
    for (const team of NFL_TEAMS) {
      const stableKey = teamStableKey(team.abbr);
      const existing = await ctx.db
        .query("nflTeams")
        .withIndex("by_stableKey", (q) => q.eq("stableKey", stableKey))
        .unique();
      let id: Id<"nflTeams">;
      if (existing) {
        await ctx.db.patch(existing._id, {
          name: team.name,
          abbreviation: team.abbr,
          logoUrl: NFL_TEAM_LOGO_URLS[team.abbr],
          sportsDbTeamId: team.sportsDbTeamId,
        });
        id = existing._id;
      } else {
        id = await ctx.db.insert("nflTeams", {
          stableKey,
          name: team.name,
          abbreviation: team.abbr,
          logoUrl: NFL_TEAM_LOGO_URLS[team.abbr],
          sportsDbTeamId: team.sportsDbTeamId,
        });
      }
      teamIds.push(id);
      abbrToId.set(team.abbr, id);
    }

    let gameCount = 0;
    for (let week = 1; week <= 4; week++) {
      const kickoffBase =
        nowMs + week * 7 * 24 * 60 * 60 * 1000 + 17 * 60 * 60 * 1000;
      // Rotate pairings so weeks aren't identical.
      const order = NFL_TEAMS.map((t, i) => NFL_TEAMS[(i + week) % NFL_TEAMS.length]!);
      for (let i = 0; i + 1 < order.length; i += 2) {
        const home = order[i]!;
        const away = order[i + 1]!;
        const homeId = abbrToId.get(home.abbr);
        const awayId = abbrToId.get(away.abbr);
        if (!homeId || !awayId) continue;

        const stableKey = gameStableKey(week, away.abbr, home.abbr);
        const existing = await ctx.db
          .query("nflGames")
          .withIndex("by_stableKey", (q) => q.eq("stableKey", stableKey))
          .unique();
        const fields = {
          seasonId: season._id,
          seasonLabel: SEASON_LABEL,
          week,
          homeTeamId: homeId,
          awayTeamId: awayId,
          scheduledKickoffMs: kickoffBase + (i / 2) * 60 * 60 * 1000,
          lifecycle: "scheduled" as const,
          homeScore: null,
          awayScore: null,
          sportsDbEventId: `seed_evt_w${week}_${away.abbr}_${home.abbr}`,
        };
        if (existing) {
          await ctx.db.patch(existing._id, fields);
        } else {
          await ctx.db.insert("nflGames", {
            stableKey,
            ...fields,
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
 * Weeks 1–2 locked + scored; week 3 locked pending; week 4 unlocked (hidden).
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

  for (let week = 1; week <= 4; week++) {
    const revisionId =
      week <= 2
        ? await ctx.db.insert("scoringRevisions", {
            poolId: args.poolId,
            week,
            kind: "survivor",
            revisionNumber: 1,
            fingerprint: `seed|${args.poolId}|w${week}`,
            publishedAtMs: args.nowMs - (5 - week) * 86_400_000,
            status: "published",
          })
        : null;

    if (week <= 2) {
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
      const locked = week <= 3;
      const pickId = await ctx.db.insert("survivorPicks", {
        poolId: args.poolId,
        participantId,
        entryId,
        week,
        nflTeamId: teamId,
        locked,
        lockedAtMs: locked ? args.nowMs - (5 - week) * 86_400_000 : undefined,
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

      if (week <= 2 && revisionId) {
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
      } else if (week === 3 && locked) {
        // Locked but unscored — pending look with revealed abbr.
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

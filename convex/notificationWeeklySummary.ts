import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import {
  formatWeeklySummaryEmail,
  type WeeklyPoolSection,
} from "./lib/notificationBodies";
import {
  hasVerifiedEmail,
  prefersEmailWeeklySummary,
} from "./lib/notificationPrefs";
import { isPoolArchived } from "./lib/poolArchive";
import { listActiveEntriesForParticipant } from "./lib/poolEntries";
import { enqueueNotificationDelivery } from "./notificationDelivery";

/**
 * Highest NFL week whose earliest kickoff is already in the past.
 * On Tuesday after MNF this is the week just played.
 */
export async function resolveSummaryWeekForSeason(
  ctx: MutationCtx,
  seasonId: Id<"poolSeasons">,
  nowMs: number,
): Promise<number | null> {
  const games = await ctx.db
    .query("nflGames")
    .withIndex("by_seasonId", (q) => q.eq("seasonId", seasonId))
    .collect();
  let best: number | null = null;
  const earliestByWeek = new Map<number, number>();
  for (const game of games) {
    const prev = earliestByWeek.get(game.week);
    if (prev === undefined || game.scheduledKickoffMs < prev) {
      earliestByWeek.set(game.week, game.scheduledKickoffMs);
    }
  }
  for (const [week, earliest] of earliestByWeek) {
    if (earliest <= nowMs && (best === null || week > best)) {
      best = week;
    }
  }
  return best;
}

async function buildSurvivorSection(
  ctx: MutationCtx,
  pool: Doc<"pools">,
  participantId: Id<"participants">,
  week: number,
): Promise<WeeklyPoolSection | null> {
  const entries = await listActiveEntriesForParticipant(
    ctx,
    pool._id,
    participantId,
  );
  if (entries.length === 0) return null;

  const lines: string[] = [];
  let anyContent = false;
  for (const entry of entries) {
    const standing = await ctx.db
      .query("seasonStandings")
      .withIndex("by_poolId_and_entryId", (q) =>
        q.eq("poolId", pool._id).eq("entryId", entry._id),
      )
      .unique();
    const outcome = await ctx.db
      .query("survivorPickOutcomes")
      .withIndex("by_poolId_and_entryId_and_week", (q) =>
        q
          .eq("poolId", pool._id)
          .eq("entryId", entry._id)
          .eq("week", week),
      )
      .unique();

    const label =
      entries.length > 1 ? `Entry ${entry.entryNumber}` : "Your entry";
    if (outcome) {
      anyContent = true;
      if (outcome.outcome === "win" || outcome.outcome === "no_contest_advance") {
        lines.push(`${label}: advanced (${outcome.outcome})`);
      } else if (
        outcome.outcome === "loss" ||
        outcome.outcome === "tie" ||
        outcome.outcome === "missing_pick"
      ) {
        lines.push(`${label}: eliminated (${outcome.outcome})`);
      } else if (outcome.outcome === "pending") {
        lines.push(`${label}: pending scoring`);
      } else {
        lines.push(`${label}: ${outcome.outcome}`);
      }
    } else if (standing) {
      anyContent = true;
      lines.push(`${label}: ${standing.eligibility}`);
    }
  }

  const standings = await ctx.db
    .query("seasonStandings")
    .withIndex("by_poolId", (q) => q.eq("poolId", pool._id))
    .collect();
  const aliveCount = standings.filter((s) => s.eligibility === "alive").length;
  const winners = standings.filter((s) => s.eligibility === "winner");
  if (winners.length > 0) {
    lines.push(
      winners.length === 1
        ? "Pool: winner decided"
        : `Pool: ${winners.length} joint winners`,
    );
    anyContent = true;
  } else if (standings.length > 0) {
    lines.push(`Pool: ${aliveCount} still alive`);
    anyContent = true;
  }

  if (!anyContent) return null;
  return {
    poolName: pool.name,
    poolId: pool._id,
    poolType: "survivor",
    lines,
  };
}

async function buildConfidenceSection(
  ctx: MutationCtx,
  pool: Doc<"pools">,
  participantId: Id<"participants">,
  week: number,
): Promise<WeeklyPoolSection | null> {
  const entries = await listActiveEntriesForParticipant(
    ctx,
    pool._id,
    participantId,
  );
  if (entries.length === 0) return null;

  const lines: string[] = [];
  let anyContent = false;
  for (const entry of entries) {
    const weekly = await ctx.db
      .query("weeklyStandings")
      .withIndex("by_poolId_and_entryId_and_week", (q) =>
        q
          .eq("poolId", pool._id)
          .eq("entryId", entry._id)
          .eq("week", week),
      )
      .unique();
    const season = await ctx.db
      .query("seasonStandings")
      .withIndex("by_poolId_and_entryId", (q) =>
        q.eq("poolId", pool._id).eq("entryId", entry._id),
      )
      .unique();
    const label =
      entries.length > 1 ? `Entry ${entry.entryNumber}` : "Your entry";
    if (weekly) {
      anyContent = true;
      lines.push(
        `${label}: Week ${week} — ${weekly.points} pts (rank #${weekly.rank})`,
      );
    } else {
      lines.push(`${label}: Week ${week} — scoring pending`);
      anyContent = true;
    }
    if (season && season.seasonPoints !== undefined) {
      const rank =
        season.seasonRank != null ? `#${season.seasonRank}` : "unranked";
      lines.push(
        `${label}: Season — ${season.seasonPoints} pts (${rank})`,
      );
    }
  }

  if (!anyContent) return null;
  return {
    poolName: pool.name,
    poolId: pool._id,
    poolType: "confidence",
    lines,
  };
}

export const sendWeeklySummaries = internalMutation({
  args: { nowMs: v.optional(v.number()) },
  returns: v.object({
    sentAccounts: v.number(),
    week: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, args) => {
    const nowMs = args.nowMs ?? Date.now();
    const seasons = await ctx.db.query("poolSeasons").collect();
    // Prefer available seasons (newest year first); fall back to others.
    const orderedSeasons = [
      ...seasons
        .filter((s) => s.status === "available")
        .sort((a, b) => b.year - a.year),
      ...seasons
        .filter((s) => s.status !== "available")
        .sort((a, b) => b.year - a.year),
    ];

    const weekBySeason = new Map<Id<"poolSeasons">, number>();
    for (const season of orderedSeasons) {
      const week = await resolveSummaryWeekForSeason(ctx, season._id, nowMs);
      if (week !== null) {
        weekBySeason.set(season._id, week);
      }
    }
    if (weekBySeason.size === 0) {
      return { sentAccounts: 0, week: null };
    }

    // Canonical week from the preferred season; include every season that
    // resolves to that same week so active pools across seasons are covered.
    const preferredSeason = orderedSeasons.find((s) =>
      weekBySeason.has(s._id),
    )!;
    const summaryWeek = weekBySeason.get(preferredSeason._id)!;
    const seasonYear = preferredSeason.year;
    const matchingSeasonIds = new Set(
      [...weekBySeason.entries()]
        .filter(([, week]) => week === summaryWeek)
        .map(([id]) => id),
    );

    const activePools: Array<Doc<"pools">> = [];
    for (const seasonId of matchingSeasonIds) {
      const pools = await ctx.db
        .query("pools")
        .withIndex("by_seasonId", (q) => q.eq("seasonId", seasonId))
        .collect();
      for (const pool of pools) {
        if (pool.status === "active" && !isPoolArchived(pool)) {
          activePools.push(pool);
        }
      }
    }

    const byParticipant = new Map<
      Id<"participants">,
      Array<Doc<"pools">>
    >();
    for (const pool of activePools) {
      const memberships = await ctx.db
        .query("poolMemberships")
        .withIndex("by_poolId", (q) => q.eq("poolId", pool._id))
        .collect();
      for (const m of memberships) {
        if (m.status !== "active") continue;
        const list = byParticipant.get(m.participantId) ?? [];
        list.push(pool);
        byParticipant.set(m.participantId, list);
      }
    }

    let sentAccounts = 0;
    for (const [participantId, memberPools] of byParticipant) {
      const participant = await ctx.db.get(participantId);
      if (!participant || !hasVerifiedEmail(participant)) continue;
      if (!prefersEmailWeeklySummary(participant)) continue;

      const sections: WeeklyPoolSection[] = [];
      for (const pool of memberPools) {
        const section =
          pool.type === "survivor"
            ? await buildSurvivorSection(
                ctx,
                pool,
                participantId,
                summaryWeek,
              )
            : await buildConfidenceSection(
                ctx,
                pool,
                participantId,
                summaryWeek,
              );
        if (section) sections.push(section);
      }
      if (sections.length === 0) continue;

      const { subject, bodyText } = formatWeeklySummaryEmail({
        week: summaryWeek,
        sections,
      });

      const deliveryId = await enqueueNotificationDelivery(ctx, {
        participantId,
        kind: "weekly_summary",
        dedupeKey: `weekly_summary:${seasonYear}:${summaryWeek}:${participantId}`,
        toEmail: participant.email!,
        subject,
        bodyText,
        week: summaryWeek,
        payloadSummary: `pools=${sections.length}`,
      });
      if (deliveryId) sentAccounts += 1;
    }

    return { sentAccounts, week: summaryWeek };
  },
});

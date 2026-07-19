import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { AuthError, requireParticipant } from "./lib/auth";
import {
  CONFIDENCE_SCALE_MAX,
  defaultConfidenceRanking,
  isUniqueConfidenceAssignment,
  isValidTiebreakerPrediction,
  orderPickSheetGames,
} from "./lib/confidenceScale";
import {
  computeWeeklyCutoffMs,
  isConfidenceGameLocked,
  isTiebreakerLocked,
  type SaveTrustState,
} from "./lib/pickLock";
import { isPoolArchived } from "./lib/poolArchive";
import {
  ensurePrimaryEntryIfMissing,
  listActivePoolEntries,
  requireOwnedActiveEntry,
} from "./lib/poolEntries";
import { MAX_POOL_ENTRIES } from "./lib/quotas";

class ConfidencePickError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfidencePickError";
  }
}

type DbCtx = QueryCtx | MutationCtx;

type UnitResult =
  | { ok: true }
  | { ok: false; explanation: string };

async function requirePoolMembership(
  ctx: DbCtx,
  poolId: Id<"pools">,
  participantId: Id<"participants">,
): Promise<Doc<"poolMemberships">> {
  const membership = await ctx.db
    .query("poolMemberships")
    .withIndex("by_poolId_and_participantId", (q) =>
      q.eq("poolId", poolId).eq("participantId", participantId),
    )
    .unique();
  if (!membership || membership.status !== "active") {
    throw new AuthError("Not a member of this Pool");
  }
  return membership;
}

async function loadWeekGames(
  ctx: DbCtx,
  seasonId: Id<"poolSeasons">,
  week: number,
) {
  return await ctx.db
    .query("nflGames")
    .withIndex("by_seasonId_and_week", (q) =>
      q.eq("seasonId", seasonId).eq("week", week),
    )
    .take(64);
}

async function writeSanitizedAudit(
  ctx: MutationCtx,
  args: {
    poolId: Id<"pools">;
    actorParticipantId: Id<"participants">;
    action: string;
    week: number;
    unit?: string;
  },
) {
  // Never include pickedTeamId / confidence values / tiebreaker — Hidden non-leak.
  await ctx.db.insert("poolAuditEvents", {
    poolId: args.poolId,
    actorParticipantId: args.actorParticipantId,
    action: args.action,
    atMs: Date.now(),
    metadataJson: JSON.stringify({
      week: args.week,
      ...(args.unit ? { unit: args.unit } : {}),
    }),
  });
}

function weeklyCutoffForPool(
  pool: Doc<"pools">,
  games: Doc<"nflGames">[],
): number | null {
  if (pool.pickLockMode !== "weeklyCutoff" || games.length === 0) {
    return null;
  }
  const earliest = Math.min(...games.map((g) => g.scheduledKickoffMs));
  return computeWeeklyCutoffMs(earliest);
}

/**
 * Freeze the Pick Sheet + Default Confidence Ranking for a Confidence Pool
 * Week. Idempotent — first freeze wins; subsequent calls return the same sheet.
 */
export async function ensurePickSheetDoc(
  ctx: MutationCtx,
  pool: Doc<"pools">,
  week: number,
  nowMs: number,
): Promise<Doc<"confidencePickSheets">> {
  const existing = await ctx.db
    .query("confidencePickSheets")
    .withIndex("by_poolId_and_week", (q) =>
      q.eq("poolId", pool._id).eq("week", week),
    )
    .unique();
  if (existing) {
    return existing;
  }

  const games = await loadWeekGames(ctx, pool.seasonId, week);
  if (games.length === 0) {
    throw new ConfidencePickError("Week slate has no published games");
  }

  // Pre-freeze authoritative cancellations are excluded from the Pick Sheet.
  const competitive = games.filter(
    (g) =>
      !(
        g.lifecycle === "canceled" ||
        (g.resultAuthority === "verified" && g.verifiedResult?.status === "CANC")
      ),
  );
  if (competitive.length === 0) {
    throw new ConfidencePickError("Week slate has no competitive games");
  }

  const ordered = orderPickSheetGames(competitive);
  const last = ordered[ordered.length - 1]!;

  const sheetId = await ctx.db.insert("confidencePickSheets", {
    poolId: pool._id,
    week,
    gameIds: ordered.map((g) => g._id),
    scaleMax: CONFIDENCE_SCALE_MAX,
    tiebreakerGameId: last._id,
    frozenAtMs: nowMs,
  });

  const sheet = await ctx.db.get(sheetId);
  if (!sheet) {
    throw new ConfidencePickError("Failed to freeze Pick Sheet");
  }
  return sheet;
}

async function loadOrCreatePickSet(
  ctx: MutationCtx,
  args: {
    pool: Doc<"pools">;
    sheet: Doc<"confidencePickSheets">;
    participantId: Id<"participants">;
    entryId: Id<"poolEntries">;
    week: number;
    nowMs: number;
  },
): Promise<{
  pickSet: Doc<"confidencePickSets">;
  picks: Doc<"confidencePicks">[];
  created: boolean;
}> {
  const existing = await ctx.db
    .query("confidencePickSets")
    .withIndex("by_poolId_and_entryId_and_week", (q) =>
      q
        .eq("poolId", args.pool._id)
        .eq("entryId", args.entryId)
        .eq("week", args.week),
    )
    .unique();

  if (existing) {
    const picks = await ctx.db
      .query("confidencePicks")
      .withIndex("by_pickSetId", (q) => q.eq("pickSetId", existing._id))
      .take(64);
    return { pickSet: existing, picks, created: false };
  }

  const ranking = defaultConfidenceRanking(
    args.sheet.gameIds.length,
    args.sheet.scaleMax,
  );
  const pickSetId = await ctx.db.insert("confidencePickSets", {
    poolId: args.pool._id,
    participantId: args.participantId,
    entryId: args.entryId,
    week: args.week,
    origin: "untouched",
    tiebreakerLocked: false,
    updatedAtMs: args.nowMs,
  });

  const picks: Doc<"confidencePicks">[] = [];
  for (let i = 0; i < args.sheet.gameIds.length; i++) {
    const gameId = args.sheet.gameIds[i]!;
    const confidenceValue = ranking[i]!;
    const pickId = await ctx.db.insert("confidencePicks", {
      poolId: args.pool._id,
      participantId: args.participantId,
      entryId: args.entryId,
      week: args.week,
      pickSetId,
      gameId,
      confidenceValue,
      locked: false,
      provenance: "authored",
      updatedAtMs: args.nowMs,
    });
    const pick = await ctx.db.get(pickId);
    if (pick) picks.push(pick);
  }

  const pickSet = await ctx.db.get(pickSetId);
  if (!pickSet) {
    throw new ConfidencePickError("Failed to create Confidence Pick Set");
  }
  return { pickSet, picks, created: true };
}

async function markParticipantStarted(
  ctx: MutationCtx,
  pickSet: Doc<"confidencePickSets">,
  nowMs: number,
) {
  if (pickSet.origin === "untouched") {
    await ctx.db.patch(pickSet._id, {
      origin: "authored",
      updatedAtMs: nowMs,
    });
  } else {
    await ctx.db.patch(pickSet._id, { updatedAtMs: nowMs });
  }
}

async function freezeRulesIfNeeded(
  ctx: MutationCtx,
  pool: Doc<"pools">,
) {
  if (!pool.rulesFrozen) {
    await ctx.db.patch(pool._id, { rulesFrozen: true });
  }
}

/**
 * Open / ensure the Confidence Pick Window: freeze Pick Sheet for the week.
 */
export const ensurePickSheet = mutation({
  args: {
    poolId: v.id("pools"),
    week: v.number(),
    entryId: v.optional(v.id("poolEntries")),
  },
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const pool = await ctx.db.get(args.poolId);
    if (!pool) {
      throw new ConfidencePickError("Pool not found");
    }
    if (pool.type !== "confidence") {
      throw new ConfidencePickError(
        "Pick Sheets only apply to Confidence Pools",
      );
    }
    const membership = await requirePoolMembership(
      ctx,
      pool._id,
      participant._id,
    );

    if (args.week < pool.startWeek || args.week > 18) {
      throw new ConfidencePickError("Week is outside this Pool's included weeks");
    }

    const nowMs = Date.now();
    await ensurePrimaryEntryIfMissing(ctx, {
      poolId: pool._id,
      participantId: participant._id,
      membershipId: membership._id,
      nowMs,
    });
    const entry = await requireOwnedActiveEntry(ctx, {
      poolId: pool._id,
      participantId: participant._id,
      entryId: args.entryId,
    });

    const sheet = await ensurePickSheetDoc(ctx, pool, args.week, nowMs);
    const ranking = defaultConfidenceRanking(
      sheet.gameIds.length,
      sheet.scaleMax,
    );

    // Lazily materialize the caller's untouched set so the board has values.
    await loadOrCreatePickSet(ctx, {
      pool,
      sheet,
      participantId: participant._id,
      entryId: entry._id,
      week: args.week,
      nowMs,
    });

    return {
      poolId: pool._id,
      week: args.week,
      gameIds: sheet.gameIds,
      scaleMax: sheet.scaleMax,
      defaultRanking: ranking,
      tiebreakerGameId: sheet.tiebreakerGameId,
      frozenAtMs: sheet.frozenAtMs,
      entryId: entry._id,
    };
  },
});

/**
 * Autosave Confidence edits. Each unit (prediction / reorder / tiebreaker)
 * succeeds or fails independently; responses explain each failed unit.
 * Client clocks are ignored.
 */
export const autosaveConfidence = mutation({
  args: {
    poolId: v.id("pools"),
    week: v.number(),
    entryId: v.optional(v.id("poolEntries")),
    predictions: v.optional(
      v.array(
        v.object({
          gameId: v.id("nflGames"),
          pickedTeamId: v.id("nflTeams"),
        }),
      ),
    ),
    /** Full confidence assignment for still-unlocked games only (atomic). */
    confidenceReorder: v.optional(
      v.array(
        v.object({
          gameId: v.id("nflGames"),
          confidenceValue: v.number(),
        }),
      ),
    ),
    /** Pass a number to set; omit to leave unchanged. */
    tiebreakerPrediction: v.optional(v.number()),
    clientNowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const pool = await ctx.db.get(args.poolId);
    if (!pool) {
      throw new ConfidencePickError("Pool not found");
    }
    if (pool.type !== "confidence") {
      throw new ConfidencePickError(
        "Confidence picks only apply to Confidence Pools",
      );
    }
    const membership = await requirePoolMembership(
      ctx,
      pool._id,
      participant._id,
    );
    if (isPoolArchived(pool)) {
      throw new ConfidencePickError(
        "Archived Pools are read-only for picks — restore to edit",
      );
    }

    if (args.week < pool.startWeek || args.week > 18) {
      throw new ConfidencePickError("Week is outside this Pool's included weeks");
    }

    const nowMs = Date.now();
    await ensurePrimaryEntryIfMissing(ctx, {
      poolId: pool._id,
      participantId: participant._id,
      membershipId: membership._id,
      nowMs,
    });
    const entry = await requireOwnedActiveEntry(ctx, {
      poolId: pool._id,
      participantId: participant._id,
      entryId: args.entryId,
    });

    const sheet = await ensurePickSheetDoc(ctx, pool, args.week, nowMs);
    const games = await loadWeekGames(ctx, pool.seasonId, args.week);
    const gameById = new Map(games.map((g) => [g._id, g] as const));
    const weeklyCutoffMs = weeklyCutoffForPool(pool, games);

    const { pickSet, picks } = await loadOrCreatePickSet(ctx, {
      pool,
      sheet,
      participantId: participant._id,
      entryId: entry._id,
      week: args.week,
      nowMs,
    });

    const pickByGame = new Map(picks.map((p) => [p.gameId, p] as const));

    const predictionResults: Array<{
      gameId: Id<"nflGames">;
    } & UnitResult> = [];
    let anyAccepted = false;

    for (const pred of args.predictions ?? []) {
      const game = gameById.get(pred.gameId);
      const pick = pickByGame.get(pred.gameId);
      if (!game || !pick || !sheet.gameIds.includes(pred.gameId)) {
        predictionResults.push({
          gameId: pred.gameId,
          ok: false,
          explanation: "Game is not on this week's Pick Sheet",
        });
        continue;
      }
      if (
        pred.pickedTeamId !== game.homeTeamId &&
        pred.pickedTeamId !== game.awayTeamId
      ) {
        predictionResults.push({
          gameId: pred.gameId,
          ok: false,
          explanation: "Picked team must be home or away for that game",
        });
        continue;
      }
      if (pick.locked) {
        predictionResults.push({
          gameId: pred.gameId,
          ok: false,
          explanation:
            "Pick Lock has been reached for this Confidence prediction — changes are rejected",
        });
        continue;
      }
      if (
        isConfidenceGameLocked({
          pickLockMode: pool.pickLockMode,
          game,
          weeklyCutoffMs,
          nowMs,
        })
      ) {
        predictionResults.push({
          gameId: pred.gameId,
          ok: false,
          explanation:
            "Pick Lock has been reached for this Confidence prediction — changes are rejected",
        });
        continue;
      }

      await ctx.db.patch(pick._id, {
        pickedTeamId: pred.pickedTeamId,
        provenance:
          pickSet.origin === "automatic" ? "automatic" : "authored",
        updatedAtMs: nowMs,
      });
      predictionResults.push({ gameId: pred.gameId, ok: true });
      anyAccepted = true;
    }

    let confidenceReorderResult: UnitResult | null = null;
    if (args.confidenceReorder !== undefined) {
      const unlockedPicks = picks.filter((p) => {
        if (p.locked) return false;
        const g = gameById.get(p.gameId);
        if (!g) return false;
        return !isConfidenceGameLocked({
          pickLockMode: pool.pickLockMode,
          game: g,
          weeklyCutoffMs,
          nowMs,
        });
      });
      const allowedValues = unlockedPicks.map((p) => p.confidenceValue);
      const reorderGameIds = new Set(
        args.confidenceReorder.map((r) => r.gameId),
      );
      const unlockedIds = new Set(unlockedPicks.map((p) => p.gameId));

      const coversExactly =
        reorderGameIds.size === unlockedIds.size &&
        [...reorderGameIds].every((id) => unlockedIds.has(id));

      const assignedValues = args.confidenceReorder.map(
        (r) => r.confidenceValue,
      );

      if (!coversExactly) {
        confidenceReorderResult = {
          ok: false,
          explanation:
            "Confidence reorder must include every unlocked game exactly once",
        };
      } else if (
        !isUniqueConfidenceAssignment(assignedValues, allowedValues)
      ) {
        confidenceReorderResult = {
          ok: false,
          explanation:
            "Confidence values must be unique and stay within the still-available unlocked set",
        };
      } else {
        // Reject if any listed game is locked (range/locked-value boundary).
        let lockedViolation = false;
        for (const row of args.confidenceReorder) {
          const pick = pickByGame.get(row.gameId);
          const g = gameById.get(row.gameId);
          if (!pick || !g || pick.locked) {
            lockedViolation = true;
            break;
          }
          if (
            isConfidenceGameLocked({
              pickLockMode: pool.pickLockMode,
              game: g,
              weeklyCutoffMs,
              nowMs,
            })
          ) {
            lockedViolation = true;
            break;
          }
        }
        if (lockedViolation) {
          confidenceReorderResult = {
            ok: false,
            explanation:
              "Pick Lock has been reached for a confidence value — reorder rejected",
          };
        } else {
          for (const row of args.confidenceReorder) {
            const pick = pickByGame.get(row.gameId)!;
            await ctx.db.patch(pick._id, {
              confidenceValue: row.confidenceValue,
              updatedAtMs: nowMs,
            });
          }
          confidenceReorderResult = { ok: true };
          anyAccepted = true;
        }
      }
    }

    let tiebreakerResult: UnitResult | null = null;
    if (args.tiebreakerPrediction !== undefined) {
      const tbGame = gameById.get(sheet.tiebreakerGameId);
      if (!tbGame) {
        tiebreakerResult = {
          ok: false,
          explanation: "Tiebreaker game is missing from the slate",
        };
      } else if (
        pickSet.tiebreakerLocked ||
        isTiebreakerLocked({
          pickLockMode: pool.pickLockMode,
          tiebreakerGame: tbGame,
          weeklyCutoffMs,
          nowMs,
        })
      ) {
        tiebreakerResult = {
          ok: false,
          explanation:
            "Pick Lock has been reached for the Weekly Tiebreaker Prediction — changes are rejected",
        };
      } else if (!isValidTiebreakerPrediction(args.tiebreakerPrediction)) {
        tiebreakerResult = {
          ok: false,
          explanation:
            "Weekly Tiebreaker Prediction must be a whole number from 0 through 200",
        };
      } else {
        await ctx.db.patch(pickSet._id, {
          tiebreakerPrediction: args.tiebreakerPrediction,
          updatedAtMs: nowMs,
        });
        tiebreakerResult = { ok: true };
        anyAccepted = true;
      }
    }

    if (anyAccepted) {
      const fresh = await ctx.db.get(pickSet._id);
      if (fresh) {
        await markParticipantStarted(ctx, fresh, nowMs);
      }
      await freezeRulesIfNeeded(ctx, pool);
      await writeSanitizedAudit(ctx, {
        poolId: pool._id,
        actorParticipantId: participant._id,
        action: "confidence_pick_autosaved",
        week: args.week,
      });
    }

    const allOk =
      predictionResults.every((r) => r.ok) &&
      (confidenceReorderResult === null || confidenceReorderResult.ok) &&
      (tiebreakerResult === null || tiebreakerResult.ok);

    const firstFailure =
      predictionResults.find((r) => !r.ok)?.explanation ??
      (confidenceReorderResult && !confidenceReorderResult.ok
        ? confidenceReorderResult.explanation
        : undefined) ??
      (tiebreakerResult && !tiebreakerResult.ok
        ? tiebreakerResult.explanation
        : undefined);

    const saveTrust: SaveTrustState = allOk
      ? { status: "saved", savedAtMs: nowMs }
      : {
          status: "error",
          explanation: firstFailure ?? "One or more Confidence edits failed",
        };

    // If nothing was submitted, treat as no-op saved.
    const submittedAnything =
      (args.predictions?.length ?? 0) > 0 ||
      args.confidenceReorder !== undefined ||
      args.tiebreakerPrediction !== undefined;

    return {
      entryId: entry._id,
      units: {
        predictions: predictionResults,
        confidenceReorder: confidenceReorderResult,
        tiebreaker: tiebreakerResult,
      },
      saveTrust: submittedAnything
        ? saveTrust
        : ({ status: "saved", savedAtMs: nowMs } satisfies SaveTrustState),
    };
  },
});

/**
 * Materialize Confidence Pick Locks: lock due components, create Automatic
 * Confidence Pick Sets for untouched participants at first required lock,
 * and mark locked blanks in started sets as omissions.
 */
export const materializeConfidenceLocks = mutation({
  args: {
    poolId: v.id("pools"),
    week: v.number(),
  },
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const pool = await ctx.db.get(args.poolId);
    if (!pool) {
      throw new ConfidencePickError("Pool not found");
    }
    await requirePoolMembership(ctx, pool._id, participant._id);
    if (pool.type !== "confidence") {
      return {
        lockedPickCount: 0,
        automaticSetCount: 0,
        tiebreakerLockedCount: 0,
      };
    }

    const nowMs = Date.now();
    const sheet = await ensurePickSheetDoc(ctx, pool, args.week, nowMs);
    const games = await loadWeekGames(ctx, pool.seasonId, args.week);
    const gameById = new Map(games.map((g) => [g._id, g] as const));
    const weeklyCutoffMs = weeklyCutoffForPool(pool, games);

    const dueGameIds = sheet.gameIds.filter((gid) => {
      const g = gameById.get(gid);
      if (!g) return false;
      return isConfidenceGameLocked({
        pickLockMode: pool.pickLockMode,
        game: g,
        weeklyCutoffMs,
        nowMs,
      });
    });

    const firstRequiredLockReached = dueGameIds.length > 0;
    const tbGame = gameById.get(sheet.tiebreakerGameId);
    const tbDue =
      tbGame !== undefined &&
      isTiebreakerLocked({
        pickLockMode: pool.pickLockMode,
        tiebreakerGame: tbGame,
        weeklyCutoffMs,
        nowMs,
      });

    const memberships = (
      await ctx.db
        .query("poolMemberships")
        .withIndex("by_poolId", (q) => q.eq("poolId", pool._id))
        .take(MAX_POOL_ENTRIES)
    ).filter((m) => m.status === "active");

    for (const m of memberships) {
      await ensurePrimaryEntryIfMissing(ctx, {
        poolId: pool._id,
        participantId: m.participantId,
        membershipId: m._id,
        nowMs,
      });
    }

    const entries = await listActivePoolEntries(ctx, pool._id);

    let lockedPickCount = 0;
    let automaticSetCount = 0;
    let tiebreakerLockedCount = 0;

    for (const entry of entries) {
      let { pickSet, picks } = await loadOrCreatePickSet(ctx, {
        pool,
        sheet,
        participantId: entry.participantId,
        entryId: entry._id,
        week: args.week,
        nowMs,
      });

      // Automatic Confidence Pick Set at first required lock if still untouched.
      if (firstRequiredLockReached && pickSet.origin === "untouched") {
        const ranking = defaultConfidenceRanking(
          sheet.gameIds.length,
          sheet.scaleMax,
        );
        for (let i = 0; i < sheet.gameIds.length; i++) {
          const gameId = sheet.gameIds[i]!;
          const game = gameById.get(gameId);
          const pick = picks.find((p) => p.gameId === gameId);
          if (!game || !pick) continue;
          await ctx.db.patch(pick._id, {
            pickedTeamId: game.homeTeamId,
            confidenceValue: ranking[i]!,
            provenance: "automatic",
            updatedAtMs: nowMs,
          });
        }
        await ctx.db.patch(pickSet._id, {
          origin: "automatic",
          updatedAtMs: nowMs,
        });
        automaticSetCount += 1;
        // Reload picks after automatic fill.
        picks = await ctx.db
          .query("confidencePicks")
          .withIndex("by_pickSetId", (q) => q.eq("pickSetId", pickSet._id))
          .take(64);
        const refreshed = await ctx.db.get(pickSet._id);
        if (refreshed) pickSet = refreshed;
      }

      for (const pick of picks) {
        if (pick.locked) continue;
        const game = gameById.get(pick.gameId);
        if (!game) continue;
        if (
          !isConfidenceGameLocked({
            pickLockMode: pool.pickLockMode,
            game,
            weeklyCutoffMs,
            nowMs,
          })
        ) {
          continue;
        }

        const hasPrediction = pick.pickedTeamId !== undefined;
        const isStarted =
          pickSet.origin === "authored" || pickSet.origin === "automatic";

        if (!hasPrediction && isStarted) {
          await ctx.db.patch(pick._id, {
            locked: true,
            lockedAtMs: nowMs,
            provenance: "omission",
            updatedAtMs: nowMs,
          });
        } else {
          await ctx.db.patch(pick._id, {
            locked: true,
            lockedAtMs: nowMs,
            updatedAtMs: nowMs,
          });
        }
        lockedPickCount += 1;
      }

      if (tbDue && !pickSet.tiebreakerLocked) {
        await ctx.db.patch(pickSet._id, {
          tiebreakerLocked: true,
          updatedAtMs: nowMs,
        });
        tiebreakerLockedCount += 1;
      }
    }

    if (
      (lockedPickCount > 0 ||
        automaticSetCount > 0 ||
        tiebreakerLockedCount > 0) &&
      !pool.rulesFrozen
    ) {
      await ctx.db.patch(pool._id, { rulesFrozen: true });
    }

    return { lockedPickCount, automaticSetCount, tiebreakerLockedCount };
  },
});

/**
 * Own Confidence Pick Set for a week — author always sees predictions/values.
 */
export const getMyConfidencePickSet = query({
  args: {
    poolId: v.id("pools"),
    week: v.number(),
    entryId: v.optional(v.id("poolEntries")),
  },
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx);
    const pool = await ctx.db.get(args.poolId);
    if (!pool) {
      throw new ConfidencePickError("Pool not found");
    }
    await requirePoolMembership(ctx, pool._id, participant._id);

    const entry = await requireOwnedActiveEntry(ctx, {
      poolId: pool._id,
      participantId: participant._id,
      entryId: args.entryId,
    });

    const sheet = await ctx.db
      .query("confidencePickSheets")
      .withIndex("by_poolId_and_week", (q) =>
        q.eq("poolId", pool._id).eq("week", args.week),
      )
      .unique();
    if (!sheet) {
      return null;
    }

    const pickSet = await ctx.db
      .query("confidencePickSets")
      .withIndex("by_poolId_and_entryId_and_week", (q) =>
        q
          .eq("poolId", pool._id)
          .eq("entryId", entry._id)
          .eq("week", args.week),
      )
      .unique();
    if (!pickSet) {
      return {
        entryId: entry._id,
        sheet: {
          gameIds: sheet.gameIds,
          scaleMax: sheet.scaleMax,
          tiebreakerGameId: sheet.tiebreakerGameId,
          defaultRanking: defaultConfidenceRanking(
            sheet.gameIds.length,
            sheet.scaleMax,
          ),
        },
        origin: "untouched" as const,
        tiebreakerPrediction: null,
        tiebreakerLocked: false,
        picks: [] as Array<{
          gameId: Id<"nflGames">;
          pickedTeamId: Id<"nflTeams"> | null;
          confidenceValue: number;
          locked: boolean;
          provenance: "authored" | "automatic" | "omission";
        }>,
      };
    }

    const picks = await ctx.db
      .query("confidencePicks")
      .withIndex("by_pickSetId", (q) => q.eq("pickSetId", pickSet._id))
      .take(64);

    return {
      entryId: entry._id,
      sheet: {
        gameIds: sheet.gameIds,
        scaleMax: sheet.scaleMax,
        tiebreakerGameId: sheet.tiebreakerGameId,
        defaultRanking: defaultConfidenceRanking(
          sheet.gameIds.length,
          sheet.scaleMax,
        ),
      },
      origin: pickSet.origin,
      tiebreakerPrediction: pickSet.tiebreakerPrediction ?? null,
      tiebreakerLocked: pickSet.tiebreakerLocked,
      picks: picks.map((p) => ({
        gameId: p.gameId,
        pickedTeamId: p.pickedTeamId ?? null,
        confidenceValue: p.confidenceValue,
        locked: p.locked,
        provenance: p.provenance,
      })),
    };
  },
});

/**
 * Shared validators and helpers for sync observation mutations.
 */

import { v } from "convex/values";

export const terminalStatusValidator = v.union(
  v.literal("FT"),
  v.literal("AOT"),
  v.literal("CANC"),
);

export const lifecycleValidator = v.union(
  v.literal("scheduled"),
  v.literal("in_progress"),
  v.literal("interrupted"),
  v.literal("postponed"),
  v.literal("canceled"),
  v.literal("terminal"),
  v.literal("unknown"),
);

export const liveObservationValidator = v.object({
  gameId: v.id("nflGames"),
  observedAtMs: v.number(),
  lifecycle: lifecycleValidator,
  homeScore: v.union(v.number(), v.null()),
  awayScore: v.union(v.number(), v.null()),
  /** Present when provider reports FT/AOT/CANC. */
  terminalStatus: v.optional(terminalStatusValidator),
});

export const scheduleObservationValidator = v.object({
  gameId: v.id("nflGames"),
  observedAtMs: v.number(),
  scheduledKickoffMs: v.number(),
  lifecycle: lifecycleValidator,
});

export const LEASE_MS = 90_000;

export function liveScopeKey(seasonId: string): string {
  return `live:${seasonId}`;
}

export function scheduleScopeKey(seasonId: string): string {
  return `schedule:${seasonId}`;
}

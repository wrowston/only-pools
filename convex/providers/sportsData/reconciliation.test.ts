import { describe, expect, it } from "vitest";
import { reconcileNflGameIdentity } from "./reconciliation";

const observedGame = {
  seasonKey: "season-2026",
  week: 4,
  awayTeamStableKey: "nfl-team:franchise-11",
  homeTeamStableKey: "nfl-team:franchise-12",
  scheduledKickoffMs: Date.parse("2026-09-27T20:25:00Z"),
} as const;

describe("NFL Game identity reconciliation", () => {
  it("preserves identity when kickoff and provider id are replaced", () => {
    const result = reconcileNflGameIdentity({
      aliasOwnership: { kind: "unclaimed" },
      observedGame,
      candidates: [
        {
          gameId: "game-1",
          seasonKey: "season-2026",
          week: 4,
          awayTeamStableKey: "nfl-team:franchise-11",
          homeTeamStableKey: "nfl-team:franchise-12",
          scheduledKickoffMs: Date.parse("2026-09-27T17:00:00Z"),
          scheduleHistoryMs: [
            Date.parse("2026-09-27T17:00:00Z"),
          ],
        },
      ],
    });

    expect(result).toEqual({
      kind: "resolved",
      gameId: "game-1",
      reason: "canonical_identity",
    });
  });

  it("uses schedule history only to disambiguate exact canonical candidates", () => {
    const result = reconcileNflGameIdentity({
      aliasOwnership: { kind: "unclaimed" },
      observedGame,
      candidates: [
        {
          gameId: "game-1",
          ...observedGame,
          scheduleHistoryMs: [
            Date.parse("2026-09-27T17:00:00Z"),
          ],
        },
        {
          gameId: "game-2",
          ...observedGame,
          scheduleHistoryMs: [observedGame.scheduledKickoffMs],
        },
      ],
    });

    expect(result).toEqual({
      kind: "resolved",
      gameId: "game-2",
      reason: "schedule_history",
    });
  });

  it("refuses ambiguous aliases and indistinguishable canonical candidates", () => {
    expect(
      reconcileNflGameIdentity({
        aliasOwnership: {
          kind: "ambiguous",
          ownerIds: ["game-1", "game-2"],
        },
        observedGame,
        candidates: [],
      }),
    ).toEqual({
      kind: "conflict",
      reason: "ambiguous_alias",
      gameIds: ["game-1", "game-2"],
    });

    expect(
      reconcileNflGameIdentity({
        aliasOwnership: { kind: "unclaimed" },
        observedGame,
        candidates: [
          {
            gameId: "game-1",
            ...observedGame,
            scheduleHistoryMs: [],
          },
          {
            gameId: "game-2",
            ...observedGame,
            scheduleHistoryMs: [],
          },
        ],
      }),
    ).toEqual({
      kind: "conflict",
      reason: "ambiguous_canonical_identity",
      gameIds: ["game-1", "game-2"],
    });
  });

  it("does not reconcile a known alias to conflicting canonical identity", () => {
    const result = reconcileNflGameIdentity({
      aliasOwnership: { kind: "owned", ownerId: "game-1" },
      observedGame,
      candidates: [
        {
          gameId: "game-1",
          seasonKey: "season-2026",
          week: 5,
          awayTeamStableKey: "nfl-team:franchise-11",
          homeTeamStableKey: "nfl-team:franchise-12",
          scheduledKickoffMs: Date.parse("2026-10-04T17:00:00Z"),
          scheduleHistoryMs: [],
        },
      ],
    });

    expect(result).toEqual({
      kind: "conflict",
      reason: "alias_identity_mismatch",
      gameIds: ["game-1"],
    });
  });
});

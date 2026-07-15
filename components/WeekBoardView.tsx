"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  officialWinnerTeamId,
  pickOutcomeLabel,
  pickOutcomeMark,
  resolvePickOutcome,
  teamPickAccessibleName,
} from "@/lib/pickPresentation";
import { TOUCH_TARGET_MIN_CLASS } from "@/lib/gameDayShell";
import { ConfidenceStandingsPeek } from "./ConfidenceStandingsPeek";
import { EmptyState } from "./EmptyState";
import { PoolShell } from "./PoolShell";
import { SaveTrust } from "./SaveTrust";
import { SurvivorStandingsPeek } from "./SurvivorStandingsPeek";

function formatKickoff(ms: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

type TrustStatus = "idle" | "saving" | "saved" | "error";

export function WeekBoardView({
  poolId,
  week,
}: {
  poolId: Id<"pools">;
  week?: number;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const board = useQuery(
    api.pools.getWeekBoard,
    isAuthenticated ? { poolId, week } : "skip",
  );
  const autosaveSurvivor = useMutation(api.survivorPicks.autosaveSurvivorPick);
  const materializeSurvivor = useMutation(
    api.survivorPicks.materializeSurvivorLocks,
  );
  const ensurePickSheet = useMutation(api.confidencePicks.ensurePickSheet);
  const autosaveConfidence = useMutation(api.confidencePicks.autosaveConfidence);
  const materializeConfidence = useMutation(
    api.confidencePicks.materializeConfidenceLocks,
  );

  const [trust, setTrust] = useState<{
    status: TrustStatus;
    explanation?: string;
  }>({ status: "idle" });
  const [pendingTeamId, setPendingTeamId] = useState<Id<"nflTeams"> | null>(
    null,
  );
  const [materializedWeek, setMaterializedWeek] = useState<number | null>(null);
  const [sheetEnsured, setSheetEnsured] = useState(false);
  const [localConfidence, setLocalConfidence] = useState<
    Record<string, number>
  >({});
  const [tiebreakerDraft, setTiebreakerDraft] = useState<string>("");
  const [confidenceConflict, setConfidenceConflict] = useState<string | null>(
    null,
  );

  // Confidence: open Pick Window / freeze sheet on first board visit.
  useEffect(() => {
    if (!board || board.pool.type !== "confidence") return;
    if (sheetEnsured) return;
    setSheetEnsured(true);
    void ensurePickSheet({ poolId, week: board.week }).catch(() => {
      setSheetEnsured(false);
    });
  }, [board, ensurePickSheet, poolId, sheetEnsured]);

  // Materialize locks once when any slate game has reached kickoff/cutoff.
  useEffect(() => {
    if (!board) return;
    if (!board.slate.some((g) => g.locked)) return;
    if (materializedWeek === board.week) return;
    setMaterializedWeek(board.week);
    const run =
      board.pool.type === "survivor"
        ? materializeSurvivor({ poolId, week: board.week })
        : materializeConfidence({ poolId, week: board.week });
    void run.catch(() => {
      setMaterializedWeek(null);
    });
  }, [
    board,
    materializeConfidence,
    materializeSurvivor,
    materializedWeek,
    poolId,
  ]);

  // Sync local confidence map from server set.
  useEffect(() => {
    if (!board?.myConfidencePickSet) return;
    const next: Record<string, number> = {};
    for (const p of board.myConfidencePickSet.picks) {
      next[p.gameId] = p.confidenceValue;
    }
    setLocalConfidence(next);
    if (
      board.myConfidencePickSet.tiebreakerPrediction !== null &&
      tiebreakerDraft === ""
    ) {
      setTiebreakerDraft(
        String(board.myConfidencePickSet.tiebreakerPrediction),
      );
    }
  }, [board?.myConfidencePickSet, tiebreakerDraft]);

  if (isLoading || (isAuthenticated && board === undefined)) {
    return (
      <EmptyState
        title="Loading Week Board"
        description="Loading this week’s slate…"
      />
    );
  }

  if (!isAuthenticated) {
    return (
      <EmptyState
        title="Sign in to open this Pool"
        description="Week Board is available after you sign in as a Pool member."
        action={
          <Link
            href="/sign-in"
            className="rounded-md bg-op-ink px-4 py-2.5 text-sm font-medium text-white hover:bg-op-ink-hover"
          >
            Sign in
          </Link>
        }
      />
    );
  }

  if (!board) {
    return (
      <EmptyState
        title="Pool not available"
        description="This Week Board could not be loaded. You may not be a member, or the Pool may no longer be available."
        action={
          <Link
            href="/my-pools"
            className="rounded-md border border-op-border-strong px-4 py-2.5 text-sm font-medium text-op-text"
          >
            Back to My Pools
          </Link>
        }
      />
    );
  }

  const isSurvivor = board.pool.type === "survivor";
  const isConfidence = board.pool.type === "confidence";
  const selectedTeamId = pendingTeamId ?? board.mySurvivorPick?.nflTeamId ?? null;
  const myPickLocked = board.mySurvivorPick?.locked === true;
  const mySet = board.myConfidencePickSet;

  async function onSelectTeam(nflTeamId: Id<"nflTeams">, gameLocked: boolean) {
    if (!isSurvivor || myPickLocked || gameLocked) return;
    setPendingTeamId(nflTeamId);
    setTrust({ status: "saving" });
    try {
      await autosaveSurvivor({ poolId, week: board!.week, nflTeamId });
      setTrust({ status: "saved" });
      setPendingTeamId(null);
    } catch (err) {
      const explanation =
        err instanceof Error ? err.message : "Save failed — tap a team to retry";
      setTrust({ status: "error", explanation });
      setPendingTeamId(null);
    }
  }

  async function onPickWinner(
    gameId: Id<"nflGames">,
    pickedTeamId: Id<"nflTeams">,
    locked: boolean,
  ) {
    if (!isConfidence || locked) return;
    setTrust({ status: "saving" });
    try {
      const result = await autosaveConfidence({
        poolId,
        week: board!.week,
        predictions: [{ gameId, pickedTeamId }],
      });
      if (result.saveTrust.status === "error") {
        setTrust({
          status: "error",
          explanation: result.saveTrust.explanation,
        });
      } else {
        setTrust({ status: "saved" });
      }
    } catch (err) {
      setTrust({
        status: "error",
        explanation:
          err instanceof Error ? err.message : "Save failed — try again",
      });
    }
  }

  async function onConfidenceChange(
    gameId: Id<"nflGames">,
    nextValue: number,
  ) {
    if (!isConfidence || !mySet) return;
    const unlocked = mySet.picks.filter((p) => {
      const slateGame = board!.slate.find((g) => g.gameId === p.gameId);
      return !p.locked && !(slateGame?.locked ?? false);
    });
    const unlockedIds = new Set(unlocked.map((p) => p.gameId));
    if (!unlockedIds.has(gameId)) return;

    const currentValue =
      localConfidence[gameId] ??
      mySet.picks.find((p) => p.gameId === gameId)?.confidenceValue;
    if (currentValue === undefined || currentValue === nextValue) return;

    // Client uniqueness: only swap among still-available unlocked values.
    const allowed = new Set(
      unlocked.map((p) => localConfidence[p.gameId] ?? p.confidenceValue),
    );
    if (!allowed.has(nextValue)) {
      setConfidenceConflict(
        "Each unlocked game needs a unique confidence value from the available set",
      );
      return;
    }
    setConfidenceConflict(null);

    const swapTarget = unlocked.find(
      (p) =>
        p.gameId !== gameId &&
        (localConfidence[p.gameId] ?? p.confidenceValue) === nextValue,
    );

    const nextLocal = { ...localConfidence };
    if (swapTarget) {
      nextLocal[swapTarget.gameId] = currentValue;
    }
    nextLocal[gameId] = nextValue;
    setLocalConfidence(nextLocal);

    const reorder = unlocked.map((p) => ({
      gameId: p.gameId,
      confidenceValue: nextLocal[p.gameId] ?? p.confidenceValue,
    }));

    // Guard: resulting assignment must stay unique (client-side scenario 23).
    const values = reorder.map((r) => r.confidenceValue);
    if (new Set(values).size !== values.length) {
      setConfidenceConflict(
        "Each unlocked game needs a unique confidence value",
      );
      const revert: Record<string, number> = {};
      for (const p of mySet.picks) {
        revert[p.gameId] = p.confidenceValue;
      }
      setLocalConfidence(revert);
      return;
    }

    setTrust({ status: "saving" });
    try {
      const result = await autosaveConfidence({
        poolId,
        week: board!.week,
        confidenceReorder: reorder,
      });
      if (result.units.confidenceReorder?.ok === false) {
        setTrust({
          status: "error",
          explanation: result.units.confidenceReorder.explanation,
        });
        const revert: Record<string, number> = {};
        for (const p of mySet.picks) {
          revert[p.gameId] = p.confidenceValue;
        }
        setLocalConfidence(revert);
      } else if (result.saveTrust.status === "error") {
        setTrust({
          status: "error",
          explanation: result.saveTrust.explanation,
        });
      } else {
        setTrust({ status: "saved" });
      }
    } catch (err) {
      setTrust({
        status: "error",
        explanation:
          err instanceof Error ? err.message : "Save failed — try again",
      });
    }
  }

  async function onTiebreakerBlur() {
    if (!isConfidence || !mySet || mySet.tiebreakerLocked) return;
    const parsed = Number(tiebreakerDraft);
    if (
      tiebreakerDraft === "" ||
      !Number.isInteger(parsed) ||
      parsed < 0 ||
      parsed > 200
    ) {
      setTrust({
        status: "error",
        explanation:
          "Weekly Tiebreaker Prediction must be a whole number from 0 through 200",
      });
      return;
    }
    if (parsed === mySet.tiebreakerPrediction) return;
    setTrust({ status: "saving" });
    try {
      const result = await autosaveConfidence({
        poolId,
        week: board!.week,
        tiebreakerPrediction: parsed,
      });
      if (result.units.tiebreaker?.ok === false) {
        setTrust({
          status: "error",
          explanation: result.units.tiebreaker.explanation,
        });
      } else {
        setTrust({ status: "saved" });
      }
    } catch (err) {
      setTrust({
        status: "error",
        explanation:
          err instanceof Error ? err.message : "Save failed — try again",
      });
    }
  }

  const unlockedConfidenceValues = (mySet?.picks ?? [])
    .filter((p) => {
      const slateGame = board.slate.find((g) => g.gameId === p.gameId);
      return !p.locked && !(slateGame?.locked ?? false);
    })
    .map((p) => localConfidence[p.gameId] ?? p.confidenceValue)
    .sort((a, b) => b - a);

  const contextRail = isConfidence ? (
    <ConfidenceStandingsPeek poolId={poolId} week={board.week} />
  ) : (
    <SurvivorStandingsPeek poolId={poolId} />
  );

  return (
    <PoolShell
      poolId={poolId}
      poolName={board.pool.name}
      contextRail={contextRail}
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-8 min-[900px]:max-w-3xl min-[900px]:px-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-op-text min-[900px]:text-3xl">
          Week Board
        </h1>
        <p className="text-sm text-op-secondary">
          Week {board.week} · {isSurvivor ? "Survivor" : "Confidence"}
          {board.pool.seasonLabel
            ? ` · Season ${board.pool.seasonLabel}`
            : null}
        </p>
      </header>

      {isSurvivor ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-op-secondary">
            {myPickLocked
              ? board.mySurvivorPick?.provenance === "omission"
                ? "Locked omission — no pick"
                : `Locked · ${board.mySurvivorPick?.nflTeamId ? "your pick is visible to the pool" : "locked"}`
              : "Tap a team to autosave your Survivor Pick. Hidden from others until Pick Lock."}
          </p>
          <SaveTrust
            status={
              trust.status === "idle" && board.mySurvivorPick
                ? "saved"
                : trust.status
            }
            explanation={trust.explanation}
          />
        </div>
      ) : null}

      {isConfidence ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-op-secondary">
            {mySet?.origin === "automatic"
              ? "Automatic Confidence Pick Set — later unlocked games remain editable. Origin retained."
              : "Pick winners and unique confidence values. Autosaves; hidden until Pick Lock."}
          </p>
          <SaveTrust
            status={
              trust.status === "idle" && mySet && mySet.origin !== "untouched"
                ? "saved"
                : trust.status
            }
            explanation={trust.explanation}
          />
          {confidenceConflict ? (
            <p className="text-sm text-op-lost-fg" role="alert">
              {confidenceConflict}
            </p>
          ) : null}
        </div>
      ) : null}

      <section aria-labelledby="slate-heading" className="flex flex-col gap-3">
        <h2
          id="slate-heading"
          className="text-sm font-medium uppercase tracking-wide text-op-muted"
        >
          Slate
        </h2>
        {board.slate.length === 0 ? (
          <EmptyState
            title="No slate this week"
            description="There is no published slate for this Pool Week yet."
          />
        ) : (
          <ul className="divide-y divide-op-border rounded-xl border border-op-border bg-op-surface min-[900px]:overflow-hidden">
            {board.slate.map((game) => {
              const confPick = mySet?.picks.find(
                (p) => p.gameId === game.gameId,
              );
              const confLocked = confPick?.locked === true || game.locked;
              const confValue =
                localConfidence[game.gameId] ??
                confPick?.confidenceValue ??
                null;
              const winnerId = officialWinnerTeamId({
                isOfficial: game.isOfficial,
                verifiedResult: game.verifiedResult,
                homeTeamId: game.homeTeam?.id,
                awayTeamId: game.awayTeam?.id,
              });
              const survivorOutcome = isSurvivor
                ? resolvePickOutcome({
                    pickedTeamId: selectedTeamId,
                    winnerTeamId: winnerId,
                  })
                : null;
              const confidenceOutcome = isConfidence
                ? resolvePickOutcome({
                    pickedTeamId: confPick?.pickedTeamId,
                    winnerTeamId: winnerId,
                  })
                : null;
              const rowOutcome = survivorOutcome ?? confidenceOutcome;
              return (
                <li
                  key={game.gameId}
                  className={[
                    "flex flex-col gap-3 px-4 py-4 min-[900px]:px-5",
                    rowOutcome === "won"
                      ? "bg-op-won-bg"
                      : rowOutcome === "lost"
                        ? "bg-op-lost-bg"
                        : "",
                  ].join(" ")}
                >
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm font-medium text-op-text">
                      {game.awayTeam?.abbreviation ?? "?"} @{" "}
                      {game.homeTeam?.abbreviation ?? "?"}
                      <span className="mt-0.5 block text-xs font-normal text-op-muted">
                        {game.awayTeam?.name ?? "Away"} at{" "}
                        {game.homeTeam?.name ?? "Home"}
                      </span>
                    </div>
                    <div className="text-xs text-op-muted">
                      {formatKickoff(game.scheduledKickoffMs)}
                      {game.projectedHomeScore !== null &&
                      game.projectedAwayScore !== null &&
                      (game.resultAuthority === "projected" ||
                        game.resultAuthority === "confirmation_pending" ||
                        game.resultAuthority === "verified" ||
                        game.lifecycle === "in_progress" ||
                        game.lifecycle === "terminal") ? (
                        <span className="mt-0.5 block">
                          {game.awayTeam?.abbreviation ?? "AWY"}{" "}
                          {game.projectedAwayScore} – {game.projectedHomeScore}{" "}
                          {game.homeTeam?.abbreviation ?? "HOM"}
                          {game.isOfficial ? (
                            <span className="ml-1 text-op-secondary">
                              · Verified Result
                            </span>
                          ) : (
                            <span className="ml-1 text-amber-800">
                              · Projected (non-official)
                            </span>
                          )}
                        </span>
                      ) : null}
                      {game.locked || confPick?.locked ? (
                        <span className="mt-0.5 block text-op-muted">
                          Pick Lock reached
                          {confPick?.provenance === "omission"
                            ? " · omission"
                            : confPick?.provenance === "automatic"
                              ? " · automatic"
                              : confPick?.provenance === "authored"
                                ? " · authored"
                                : ""}
                        </span>
                      ) : null}
                      {rowOutcome ? (
                        <span
                          className={
                            rowOutcome === "won"
                              ? "mt-0.5 flex items-center gap-1 font-medium text-op-won-fg"
                              : "mt-0.5 flex items-center gap-1 font-medium text-op-lost-fg"
                          }
                          data-pick-outcome={rowOutcome}
                        >
                          <span aria-hidden>{pickOutcomeMark(rowOutcome)}</span>
                          {pickOutcomeLabel(rowOutcome)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {isSurvivor ? (
                    <div className="flex flex-wrap gap-2">
                      {[game.awayTeam, game.homeTeam].map((team) => {
                        if (!team) return null;
                        const selected = selectedTeamId === team.id;
                        const disabled = myPickLocked || game.locked;
                        const teamOutcome =
                          selected && survivorOutcome ? survivorOutcome : null;
                        return (
                          <button
                            key={team.id}
                            type="button"
                            disabled={disabled}
                            onClick={() => onSelectTeam(team.id, game.locked)}
                            aria-pressed={selected}
                            aria-label={teamPickAccessibleName({
                              teamAbbreviation: team.abbreviation,
                              selected,
                              locked: disabled,
                              outcome: teamOutcome,
                            })}
                            className={[
                              TOUCH_TARGET_MIN_CLASS,
                              "rounded-md border px-4 py-2.5 text-sm font-medium transition-colors",
                              selected
                                ? "border-op-selected-fg bg-op-selected text-op-selected-fg"
                                : "border-op-border-strong bg-op-surface text-op-text",
                              disabled
                                ? "cursor-not-allowed opacity-50"
                                : "hover:border-op-ink",
                            ].join(" ")}
                          >
                            {team.abbreviation}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  {isConfidence ? (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-wrap gap-2">
                        {[game.awayTeam, game.homeTeam].map((team) => {
                          if (!team) return null;
                          const selected = confPick?.pickedTeamId === team.id;
                          const teamOutcome =
                            selected && confidenceOutcome
                              ? confidenceOutcome
                              : null;
                          return (
                            <button
                              key={team.id}
                              type="button"
                              disabled={confLocked}
                              onClick={() =>
                                onPickWinner(game.gameId, team.id, confLocked)
                              }
                              aria-pressed={selected}
                              aria-label={teamPickAccessibleName({
                                teamAbbreviation: team.abbreviation,
                                selected,
                                locked: confLocked,
                                outcome: teamOutcome,
                              })}
                              className={[
                                TOUCH_TARGET_MIN_CLASS,
                                "rounded-md border px-4 py-2.5 text-sm font-medium transition-colors",
                                selected
                                  ? "border-op-selected-fg bg-op-selected text-op-selected-fg"
                                  : "border-op-border-strong bg-op-surface text-op-text",
                                confLocked
                                  ? "cursor-not-allowed opacity-50"
                                  : "hover:border-op-ink",
                              ].join(" ")}
                            >
                              {team.abbreviation}
                            </button>
                          );
                        })}
                      </div>
                      <label className="flex items-center gap-2 text-sm text-op-text">
                        <span className="text-xs uppercase tracking-wide text-op-muted">
                          Conf
                        </span>
                        <select
                          className="min-h-11 rounded-md border border-op-border-strong bg-op-surface px-3"
                          disabled={confLocked || confValue === null}
                          value={confValue ?? ""}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            if (!Number.isFinite(v)) return;
                            void onConfidenceChange(game.gameId, v);
                          }}
                          aria-label={`Confidence value for ${game.awayTeam?.abbreviation ?? "away"} at ${game.homeTeam?.abbreviation ?? "home"}`}
                        >
                          {confLocked && confValue !== null ? (
                            <option value={confValue}>{confValue}</option>
                          ) : (
                            unlockedConfidenceValues.map((v) => (
                              <option key={v} value={v}>
                                {v}
                              </option>
                            ))
                          )}
                        </select>
                      </label>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {isConfidence && mySet ? (
        <section
          aria-labelledby="tiebreaker-heading"
          className="flex flex-col gap-2"
        >
          <h2
            id="tiebreaker-heading"
            className="text-sm font-medium uppercase tracking-wide text-op-muted"
          >
            Weekly Tiebreaker Prediction
          </h2>
          <p className="text-xs text-op-muted">
            Combined final points for the last Pick Sheet game (0–200).
          </p>
          <input
            type="number"
            min={0}
            max={200}
            step={1}
            inputMode="numeric"
            disabled={mySet.tiebreakerLocked}
            value={tiebreakerDraft}
            onChange={(e) => setTiebreakerDraft(e.target.value)}
            onBlur={() => void onTiebreakerBlur()}
            className="min-h-11 w-full max-w-xs rounded-md border border-op-border-strong bg-op-surface px-3 text-sm"
            aria-label="Weekly Tiebreaker Prediction"
          />
        </section>
      ) : null}

      {board.participantPickStates.length > 0 ? (
        <section
          aria-labelledby="participants-heading"
          className="flex flex-col gap-2"
        >
          <h2
            id="participants-heading"
            className="text-sm font-medium uppercase tracking-wide text-op-muted"
          >
            Participants
          </h2>
          <ul className="divide-y divide-op-border text-sm">
            {board.participantPickStates.map((row) => (
              <li
                key={row.participantId}
                className="flex items-center justify-between py-2"
              >
                <span className="text-op-text">{row.displayName}</span>
                <span className="text-op-secondary">
                  {row.locked
                    ? isSurvivor
                      ? row.provenance === "omission"
                        ? "No pick"
                        : (row.teamAbbreviation ?? "Locked")
                      : row.provenance === "automatic"
                        ? "Locked · automatic"
                        : row.provenance === "omission"
                          ? "Locked · omission"
                          : "Locked · authored"
                    : row.hasPick
                      ? "Pick saved · Hidden"
                      : "No pick yet"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      </div>
    </PoolShell>
  );
}

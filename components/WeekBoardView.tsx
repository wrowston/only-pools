"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SaveTrust } from "./SaveTrust";

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
  const autosave = useMutation(api.survivorPicks.autosaveSurvivorPick);
  const materialize = useMutation(api.survivorPicks.materializeSurvivorLocks);

  const [trust, setTrust] = useState<{
    status: TrustStatus;
    explanation?: string;
  }>({ status: "idle" });
  const [pendingTeamId, setPendingTeamId] = useState<Id<"nflTeams"> | null>(
    null,
  );
  const [materializedWeek, setMaterializedWeek] = useState<number | null>(null);

  // Materialize locks once when any slate game has reached kickoff.
  useEffect(() => {
    if (!board || board.pool.type !== "survivor") return;
    if (!board.slate.some((g) => g.locked)) return;
    if (materializedWeek === board.week) return;
    setMaterializedWeek(board.week);
    void materialize({ poolId, week: board.week }).catch(() => {
      setMaterializedWeek(null);
    });
  }, [board, materialize, materializedWeek, poolId]);

  if (isLoading || (isAuthenticated && board === undefined)) {
    return (
      <div className="px-6 py-16 text-sm text-zinc-600 dark:text-zinc-400">
        Loading Week Board…
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-sm">
        <Link href="/sign-in" className="underline">
          Sign in
        </Link>{" "}
        to open this Pool.
      </div>
    );
  }

  if (!board) {
    return null;
  }

  const isSurvivor = board.pool.type === "survivor";
  const selectedTeamId = pendingTeamId ?? board.mySurvivorPick?.nflTeamId ?? null;
  const myPickLocked = board.mySurvivorPick?.locked === true;

  async function onSelectTeam(nflTeamId: Id<"nflTeams">, gameLocked: boolean) {
    if (!isSurvivor || myPickLocked || gameLocked) return;
    setPendingTeamId(nflTeamId);
    setTrust({ status: "saving" });
    try {
      await autosave({ poolId, week: board!.week, nflTeamId });
      setTrust({ status: "saved" });
      setPendingTeamId(null);
    } catch (err) {
      const explanation =
        err instanceof Error ? err.message : "Save failed — tap a team to retry";
      setTrust({ status: "error", explanation });
      setPendingTeamId(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-3">
        <Link
          href="/my-pools"
          className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← My Pools
        </Link>
        <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {board.pool.name}
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Week {board.week} ·{" "}
              {isSurvivor ? "Survivor" : "Confidence"}
              {board.pool.seasonLabel
                ? ` · Season ${board.pool.seasonLabel}`
                : null}
            </p>
          </div>
          <nav
            aria-label="Pool sections"
            className="flex flex-wrap gap-2 text-sm"
          >
            <span className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
              Board
            </span>
            <Link
              href={`/pools/${poolId}/standings`}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
            >
              Standings
            </Link>
            <Link
              href={`/pools/${poolId}/pool`}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
            >
              Pool
            </Link>
          </nav>
        </header>
      </div>

      {isSurvivor ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
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

      <section aria-labelledby="slate-heading" className="flex flex-col gap-3">
        <h2
          id="slate-heading"
          className="text-sm font-medium uppercase tracking-wide text-zinc-500"
        >
          Week Board
        </h2>
        {board.slate.length === 0 ? (
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            No published slate for this week.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {board.slate.map((game) => (
              <li key={game.gameId} className="flex flex-col gap-3 py-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {game.awayTeam?.abbreviation ?? "?"} @{" "}
                    {game.homeTeam?.abbreviation ?? "?"}
                    <span className="mt-0.5 block text-xs font-normal text-zinc-500">
                      {game.awayTeam?.name ?? "Away"} at{" "}
                      {game.homeTeam?.name ?? "Home"}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-500">
                    {formatKickoff(game.scheduledKickoffMs)}
                    {game.locked ? (
                      <span className="mt-0.5 block text-zinc-400">
                        Pick Lock reached
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
                      return (
                        <button
                          key={team.id}
                          type="button"
                          disabled={disabled}
                          onClick={() => onSelectTeam(team.id, game.locked)}
                          aria-pressed={selected}
                          className={[
                            "min-h-11 min-w-11 rounded-md border px-4 py-2.5 text-sm font-medium transition-colors",
                            selected
                              ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                              : "border-zinc-300 text-zinc-800 dark:border-zinc-600 dark:text-zinc-200",
                            disabled
                              ? "cursor-not-allowed opacity-50"
                              : "hover:border-zinc-500",
                          ].join(" ")}
                        >
                          {team.abbreviation}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-400">
                    Confidence picks come in a later ticket
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {isSurvivor && board.participantPickStates.length > 0 ? (
        <section
          aria-labelledby="participants-heading"
          className="flex flex-col gap-2"
        >
          <h2
            id="participants-heading"
            className="text-sm font-medium uppercase tracking-wide text-zinc-500"
          >
            Participants
          </h2>
          <ul className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            {board.participantPickStates.map((row) => (
              <li
                key={row.participantId}
                className="flex items-center justify-between py-2"
              >
                <span className="text-zinc-800 dark:text-zinc-200">
                  {row.displayName}
                </span>
                <span className="text-zinc-500">
                  {row.locked
                    ? row.provenance === "omission"
                      ? "No pick"
                      : (row.teamAbbreviation ?? "Locked")
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
  );
}

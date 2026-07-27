"use client";

import { useMutation, usePaginatedQuery } from "convex/react";
import { useState } from "react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { EmptyState } from "./EmptyState";
import { OperatorIncidentsListSkeleton } from "./OperatorSkeleton";

type ScoringHoldRow = {
  _id: Id<"scoringHolds">;
  poolName: string;
  poolType: "survivor" | "confidence";
  matchup: string;
  gameWeek: number;
  dependency: string;
  evaluationStatus:
    | "building"
    | "complete"
    | "incomplete"
    | "abandoned"
    | "applied";
  acceptanceStatus:
    | "validating_evaluations"
    | "validating_holds"
    | "applying_evaluations"
    | "resolving_holds"
    | null;
  candidateAwayScore: number;
  candidateHomeScore: number;
  officialAwayScore: number;
  officialHomeScore: number;
  status: "open" | "resolved";
  resolution?:
    | "accepted_correction"
    | "superseded_candidate"
    | "withdrawn_candidate";
};

export function OperatorScoringHoldsPanel() {
  const openHolds = usePaginatedQuery(
    api.scoringHolds.listOperatorScoringHolds,
    { status: "open" },
    { initialNumItems: 50 },
  );
  const resolvedHolds = usePaginatedQuery(
    api.scoringHolds.listOperatorScoringHolds,
    { status: "resolved" },
    { initialNumItems: 20 },
  );
  const resolveHold = useMutation(api.scoringHolds.resolveScoringHold);
  const [busyId, setBusyId] = useState<Id<"scoringHolds"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function acceptCorrection(holdId: Id<"scoringHolds">) {
    setError(null);
    setBusyId(holdId);
    try {
      await resolveHold({ holdId });
    } catch (cause) {
      setError(
        convexErrorMessage(cause, "Could not release the Scoring Hold"),
      );
    } finally {
      setBusyId(null);
    }
  }

  const openRows = openHolds.results as ScoringHoldRow[];
  const resolvedRows = resolvedHolds.results as ScoringHoldRow[];

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-6 pt-12">
      <h1 className="text-3xl font-semibold tracking-tight text-op-text">
        Scoring Holds
      </h1>
      <p className="text-sm text-op-secondary">
        Review corrected terminal evidence without changing the last official
        standings. Only the Production Operator may accept a result; accepting
        publishes replacement scoring revisions.
      </p>
      {error ? (
        <p className="mt-3 text-sm text-red-700 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      {openHolds.status === "LoadingFirstPage" ? (
        <OperatorIncidentsListSkeleton />
      ) : openRows.length === 0 ? (
        <EmptyState
          title="No results under review"
          description="Pool-specific holds appear here when corrected evidence has later scoring dependencies."
        />
      ) : (
        <ul className="mt-4 space-y-3">
          {openRows.map((hold) => (
            <li
              key={hold._id}
              className="rounded-md border border-op-border bg-op-surface px-4 py-3 text-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-medium text-op-text">
                    {hold.poolName} · {hold.poolType} · Week {hold.gameWeek}
                  </p>
                  <p className="mt-1 text-op-secondary">{hold.matchup}</p>
                  <p className="mt-1 text-xs text-op-muted">
                    Official {hold.officialAwayScore}–{hold.officialHomeScore};
                    corrected evidence {hold.candidateAwayScore}–
                    {hold.candidateHomeScore}. Dependency: {hold.dependency}.
                  </p>
                  {hold.dependency === "bounded_scope_exceeded" ? (
                    <p className="mt-2 text-xs font-medium text-red-700 dark:text-red-400">
                      Acceptance is disabled because dependency discovery
                      exceeded the safe scope. The official result remains in
                      place until the scope can be reviewed completely.
                    </p>
                  ) : hold.acceptanceStatus ? (
                    <p className="mt-2 text-xs font-medium text-op-secondary">
                      The accepted result is being applied to every affected
                      Pool. Official scoring remains paused for this Pool.
                    </p>
                  ) : hold.evaluationStatus === "building" ? (
                    <p className="mt-2 text-xs font-medium text-op-secondary">
                      Acceptance will become available after every Pool has
                      been evaluated.
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="op-btn op-btn-primary"
                  disabled={
                    busyId === hold._id ||
                    hold.acceptanceStatus !== null ||
                    hold.dependency === "bounded_scope_exceeded" ||
                    hold.evaluationStatus !== "complete"
                  }
                  onClick={() => void acceptCorrection(hold._id)}
                >
                  {hold.acceptanceStatus
                    ? "Applying across Pools…"
                    : hold.dependency === "bounded_scope_exceeded"
                    ? "Scope review required"
                    : hold.evaluationStatus === "building"
                      ? "Evaluating Pools…"
                      : busyId === hold._id
                        ? "Applying…"
                        : "Accept corrected result"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {openHolds.status === "CanLoadMore" ||
      openHolds.status === "LoadingMore" ? (
        <button
          type="button"
          className="op-btn op-btn-secondary mt-3 self-start"
          disabled={openHolds.status === "LoadingMore"}
          onClick={() => openHolds.loadMore(50)}
        >
          {openHolds.status === "LoadingMore"
            ? "Loading holds…"
            : "Load more open holds"}
        </button>
      ) : null}
      {resolvedRows.length > 0 ? (
        <details className="mt-4 text-sm text-op-secondary">
          <summary className="cursor-pointer font-medium text-op-text">
            Recent hold history ({resolvedRows.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {resolvedRows.map((hold) => (
              <li key={hold._id}>
                {hold.poolName} · Week {hold.gameWeek} ·{" "}
                {hold.resolution === "accepted_correction"
                  ? "correction accepted"
                  : hold.resolution === "withdrawn_candidate"
                    ? "correction withdrawn by matching official evidence"
                    : "superseded by newer evidence"}
              </li>
            ))}
          </ul>
          {resolvedHolds.status === "CanLoadMore" ||
          resolvedHolds.status === "LoadingMore" ? (
            <button
              type="button"
              className="op-btn op-btn-secondary mt-3"
              disabled={resolvedHolds.status === "LoadingMore"}
              onClick={() => resolvedHolds.loadMore(20)}
            >
              {resolvedHolds.status === "LoadingMore"
                ? "Loading history…"
                : "Load more history"}
            </button>
          ) : null}
        </details>
      ) : null}
    </section>
  );
}

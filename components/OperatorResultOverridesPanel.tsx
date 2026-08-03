"use client";

import { useReverification } from "@clerk/nextjs";
import {
  useAction,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import { useMemo, useRef, useState } from "react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { EmptyState } from "./EmptyState";
import { OperatorIncidentsListSkeleton } from "./OperatorSkeleton";

type TerminalStatus = "FT" | "AOT" | "CANC";

function evidenceLabel(evidence: {
  awayScore: number;
  homeScore: number;
  status: TerminalStatus;
  observedAtMs: number;
} | null) {
  if (!evidence) return "None retained";
  return `${evidence.awayScore}–${evidence.homeScore} ${evidence.status} · ${new Date(evidence.observedAtMs).toLocaleString()}`;
}

export function OperatorResultOverridesPanel() {
  const games = useQuery(api.resultOverrides.listOperatorVerifiedGames);
  const activeOverrides = usePaginatedQuery(
    api.resultOverrides.listOperatorResultOverrides,
    { status: "active" },
    { initialNumItems: 50 },
  );
  const overrideHistory = usePaginatedQuery(
    api.resultOverrides.listOperatorResultOverrides,
    { status: "released" },
    { initialNumItems: 20 },
  );
  const verifyOperatorStepUp = useReverification(
    useAction(api.operatorStepUp.verifyProductionOperatorStepUp),
  );
  const pinOverride = useMutation(
    api.resultOverrides.pinNflGameResultOverride,
  );
  const releaseOverride = useMutation(
    api.resultOverrides.releaseNflGameResultOverride,
  );
  const [selectedGameId, setSelectedGameId] =
    useState<Id<"nflGames"> | null>(null);
  const [homeScore, setHomeScore] = useState("");
  const [awayScore, setAwayScore] = useState("");
  const [status, setStatus] = useState<TerminalStatus>("FT");
  const [reason, setReason] = useState("");
  const [releaseReasons, setReleaseReasons] = useState<
    Record<string, string>
  >({});
  const [stepUpExpiresAtMs, setStepUpExpiresAtMs] = useState<number | null>(
    null,
  );
  const stepUpTimer = useRef<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedGame = useMemo(
    () => games?.find((game) => game.gameId === selectedGameId) ?? null,
    [games, selectedGameId],
  );
  const stepUpFresh = stepUpExpiresAtMs !== null;

  async function completeStepUp() {
    setBusy("step-up");
    setError(null);
    try {
      const result = await verifyOperatorStepUp({});
      setStepUpExpiresAtMs(result.expiresAtMs);
      if (stepUpTimer.current !== null) {
        window.clearTimeout(stepUpTimer.current);
      }
      stepUpTimer.current = window.setTimeout(() => {
        setStepUpExpiresAtMs(null);
        stepUpTimer.current = null;
      }, Math.max(0, result.expiresAtMs - Date.now()));
    } catch (cause) {
      setError(
        convexErrorMessage(cause, "Could not complete Step-up Verification"),
      );
    } finally {
      setBusy(null);
    }
  }

  async function pin() {
    if (!selectedGame || !stepUpFresh) return;
    setBusy("pin");
    setError(null);
    try {
      await pinOverride({
        gameId: selectedGame.gameId,
        reason,
        replacedResult: selectedGame.verifiedResult,
        overrideResult: {
          homeScore: Number(homeScore),
          awayScore: Number(awayScore),
          status,
        },
      });
      setReason("");
      setHomeScore("");
      setAwayScore("");
      setSelectedGameId(null);
    } catch (cause) {
      setError(convexErrorMessage(cause, "Could not pin the result override"));
    } finally {
      setBusy(null);
    }
  }

  async function release(overrideId: Id<"nflGameResultOverrides">) {
    if (!stepUpFresh) return;
    setBusy(`release:${overrideId}`);
    setError(null);
    try {
      await releaseOverride({
        overrideId,
        reason: releaseReasons[overrideId] ?? "",
      });
      setReleaseReasons((current) => {
        const next = { ...current };
        delete next[overrideId];
        return next;
      });
    } catch (cause) {
      setError(
        convexErrorMessage(cause, "Could not release the result override"),
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 pt-12">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-op-text">
          Pinned Result Overrides
        </h1>
        <p className="mt-2 text-sm text-op-secondary">
          Pin a verified NFL result only after independent confirmation.
          API-Sports evidence remains visible but cannot replace a pin until
          you release it through normal correction and Scoring Hold policy.
        </p>
      </div>

      <div className="rounded-md border border-op-border bg-op-surface p-4">
        <p className="text-sm font-medium text-op-text">
          Step-up Verification
        </p>
        <p className="mt-1 text-xs text-op-muted">
          Complete verification before choosing a destructive action. Pin and
          release never self-verify.
        </p>
        <button
          type="button"
          className="op-btn op-btn-secondary mt-3"
          disabled={busy === "step-up"}
          onClick={() => void completeStepUp()}
        >
          {busy === "step-up"
            ? "Verifying…"
            : stepUpFresh
              ? "Verification fresh"
              : "Complete Step-up Verification"}
        </button>
      </div>

      {error ? (
        <p className="text-sm text-red-700 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      <div className="rounded-md border border-op-border bg-op-surface p-4">
        <h2 className="font-medium text-op-text">Pin a Verified Result</h2>
        {games === undefined ? (
          <OperatorIncidentsListSkeleton />
        ) : games.length === 0 ? (
          <EmptyState
            title="No Verified Results"
            description="Verified NFL Games from the available season appear here."
          />
        ) : (
          <div className="mt-3 grid gap-3">
            <label className="grid gap-1 text-sm text-op-secondary">
              NFL Game
              <select
                className="rounded-md border border-op-border bg-op-bg px-3 py-2 text-op-text"
                value={selectedGameId ?? ""}
                onChange={(event) =>
                  setSelectedGameId(
                    event.target.value
                      ? (event.target.value as Id<"nflGames">)
                      : null,
                  )
                }
              >
                <option value="">Choose a Verified Result</option>
                {games
                  .filter((game) => !game.pinnedResultOverrideId)
                  .map((game) => (
                    <option key={game.gameId} value={game.gameId}>
                      {game.seasonLabel} W{game.week} · {game.matchup} ·{" "}
                      {game.verifiedResult.awayScore}–
                      {game.verifiedResult.homeScore}{" "}
                      {game.verifiedResult.status}
                    </option>
                  ))}
              </select>
            </label>
            <div className="grid grid-cols-3 gap-2">
              <label className="grid gap-1 text-xs text-op-muted">
                Away score
                <input
                  className="rounded-md border border-op-border bg-op-bg px-3 py-2 text-sm text-op-text"
                  inputMode="numeric"
                  value={awayScore}
                  onChange={(event) => setAwayScore(event.target.value)}
                />
              </label>
              <label className="grid gap-1 text-xs text-op-muted">
                Home score
                <input
                  className="rounded-md border border-op-border bg-op-bg px-3 py-2 text-sm text-op-text"
                  inputMode="numeric"
                  value={homeScore}
                  onChange={(event) => setHomeScore(event.target.value)}
                />
              </label>
              <label className="grid gap-1 text-xs text-op-muted">
                Status
                <select
                  className="rounded-md border border-op-border bg-op-bg px-3 py-2 text-sm text-op-text"
                  value={status}
                  onChange={(event) =>
                    setStatus(event.target.value as TerminalStatus)
                  }
                >
                  <option value="FT">FT</option>
                  <option value="AOT">AOT</option>
                  <option value="CANC">CANC</option>
                </select>
              </label>
            </div>
            <label className="grid gap-1 text-sm text-op-secondary">
              Reason and independent source
              <textarea
                className="min-h-20 rounded-md border border-op-border bg-op-bg px-3 py-2 text-op-text"
                maxLength={1000}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="op-btn op-btn-primary justify-self-start"
              disabled={
                !stepUpFresh ||
                !selectedGame ||
                reason.trim().length === 0 ||
                homeScore.trim().length === 0 ||
                awayScore.trim().length === 0 ||
                busy !== null
              }
              onClick={() => void pin()}
            >
              {busy === "pin" ? "Pinning… " : "Pin authoritative result"}
            </button>
          </div>
        )}
      </div>

      <div>
        <h2 className="font-medium text-op-text">Active Pins</h2>
        {activeOverrides.status === "LoadingFirstPage" ? (
          <OperatorIncidentsListSkeleton />
        ) : activeOverrides.results.length === 0 ? (
          <p className="mt-2 text-sm text-op-muted">No active result pins.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {activeOverrides.results.map((override) => (
              <li
                key={override._id}
                className="rounded-md border border-op-border bg-op-surface p-4 text-sm"
              >
                <p className="font-medium text-op-text">
                  {override.seasonLabel} W{override.week} ·{" "}
                  {override.matchup}
                </p>
                <p className="mt-1 text-op-secondary">
                  Pinned {override.overrideResult.awayScore}–
                  {override.overrideResult.homeScore}{" "}
                  {override.overrideResult.status}
                </p>
                <p className="mt-1 text-xs text-op-muted">
                  Reason: {override.reason}
                </p>
                <dl className="mt-3 grid gap-1 text-xs text-op-muted">
                  <div>
                    Latest matching evidence:{" "}
                    {evidenceLabel(override.latestMatching)}
                  </div>
                  <div>
                    Latest conflicting evidence:{" "}
                    {evidenceLabel(override.latestConflicting)}
                  </div>
                </dl>
                <label className="mt-3 grid gap-1 text-xs text-op-muted">
                  Release reason
                  <input
                    className="rounded-md border border-op-border bg-op-bg px-3 py-2 text-sm text-op-text"
                    maxLength={1000}
                    value={releaseReasons[override._id] ?? ""}
                    onChange={(event) =>
                      setReleaseReasons((current) => ({
                        ...current,
                        [override._id]: event.target.value,
                      }))
                    }
                  />
                </label>
                <button
                  type="button"
                  className="op-btn op-btn-secondary mt-3"
                  disabled={
                    !stepUpFresh ||
                    (releaseReasons[override._id] ?? "").trim().length === 0 ||
                    busy !== null
                  }
                  onClick={() => void release(override._id)}
                >
                  {busy === `release:${override._id}`
                    ? "Releasing…"
                    : "Release through provider policy"}
                </button>
              </li>
            ))}
          </ul>
        )}
        {activeOverrides.status === "CanLoadMore" ||
        activeOverrides.status === "LoadingMore" ? (
          <button
            type="button"
            className="op-btn op-btn-secondary mt-3"
            disabled={activeOverrides.status === "LoadingMore"}
            onClick={() => activeOverrides.loadMore(50)}
          >
            {activeOverrides.status === "LoadingMore"
              ? "Loading active pins…"
              : "Load more active pins"}
          </button>
        ) : null}
      </div>

      <details className="text-sm text-op-secondary">
        <summary className="cursor-pointer font-medium text-op-text">
          Released override history ({overrideHistory.results.length})
        </summary>
        <ul className="mt-3 space-y-2">
          {overrideHistory.results.map((override) => (
            <li key={override._id}>
              {override.seasonLabel} W{override.week} · {override.matchup} ·{" "}
              {override.overrideResult.awayScore}–
              {override.overrideResult.homeScore} {override.overrideResult.status}
            </li>
          ))}
        </ul>
        {overrideHistory.status === "CanLoadMore" ||
        overrideHistory.status === "LoadingMore" ? (
          <button
            type="button"
            className="op-btn op-btn-secondary mt-3"
            disabled={overrideHistory.status === "LoadingMore"}
            onClick={() => overrideHistory.loadMore(20)}
          >
            {overrideHistory.status === "LoadingMore"
              ? "Loading history…"
              : "Load more released overrides"}
          </button>
        ) : null}
      </details>
    </section>
  );
}

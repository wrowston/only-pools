"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { EmptyState } from "./EmptyState";
import { OperatorIncidentsListSkeleton } from "./OperatorSkeleton";

type IncidentRow = {
  _id: Id<"operatorIncidents">;
  type: string;
  status: string;
  severity?: "warning" | "critical";
  summary: string;
  operatorDetails?: {
    provider: string;
    lastSuccessfulIngestionAtMs: number | null;
    delayedForMs: number | null;
    thresholds: { warningMs: number; criticalMs: number };
    quota: {
      dailyUsed: number;
      dailyLimit: number;
      dailyRemaining: number | null;
      minuteUsed: number;
      minuteLimit: number;
    } | null;
    circuit: {
      status: string;
      consecutiveFailures: number;
      lastFailureReason: string | null;
    } | null;
    exception: {
      message: string;
      createdAtMs: number;
    } | null;
  } | null;
};

function operatorTime(value: number | null | undefined): string {
  return value === null || value === undefined
    ? "No successful live update yet"
    : new Date(value).toLocaleString();
}

/**
 * Minimal operator incidents panel for the allowlisted Production Operator.
 * Pool roles never see recovery controls.
 */
export function OperatorIncidentsPanel() {
  const me = useQuery(api.incidents.amIProductionOperator);
  const incidents = useQuery(
    api.incidents.listOperatorIncidents,
    me?.isOperator ? {} : "skip",
  );
  const confirmStepUp = useMutation(api.invites.confirmStepUp);
  const acknowledge = useMutation(api.incidents.acknowledgeIncident);
  const resolve = useMutation(api.incidents.resolveIncident);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (me === undefined || !me.isOperator) {
    return null;
  }

  async function withStepUp(
    incidentId: Id<"operatorIncidents">,
    action: "ack" | "resolve",
  ) {
    setError(null);
    setBusyId(incidentId);
    try {
      await confirmStepUp({});
      if (action === "ack") {
        await acknowledge({ incidentId });
      } else {
        await resolve({
          incidentId,
          resolutionNote: "Resolved from operator panel",
        });
      }
    } catch (e) {
      setError(convexErrorMessage(e, "Action failed"));
    } finally {
      setBusyId(null);
    }
  }

  const rows = (incidents ?? []) as IncidentRow[];

  return (
    <section
      className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-6 py-12"
      data-operator-incidents
    >
      <h1 className="text-3xl font-semibold tracking-tight text-op-text">
        Operator Incidents
      </h1>
      <p className="text-sm text-op-secondary">
        Production Operator recovery — step-up required for acknowledge and
        resolve. Deployment: {me.deploymentKind}
      </p>
      {error ? (
        <p className="mt-3 text-sm text-red-700 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      {incidents === undefined ? (
        <OperatorIncidentsListSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No open incidents"
          description="Provider Exception, Stale-in-window, delayed scoring, quarantine, and capacity incidents appear here when they need attention."
        />
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((inc) => (
            <li
              key={inc._id}
              className="flex flex-wrap items-center justify-between gap-3 border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700"
            >
              <div>
                <div className="font-medium text-zinc-900 dark:text-zinc-50">
                  {inc.type} · {inc.severity ?? "warning"} · {inc.status}
                </div>
                <div className="text-zinc-500 dark:text-zinc-400">
                  {inc.summary}
                </div>
                {inc.operatorDetails ? (
                  <dl className="mt-2 grid gap-x-3 text-xs text-zinc-500 dark:text-zinc-400 sm:grid-cols-2">
                    <div>
                      <dt className="inline font-medium">Provider: </dt>
                      <dd className="inline">
                        {inc.operatorDetails.provider}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline font-medium">Last success: </dt>
                      <dd className="inline">
                        {operatorTime(
                          inc.operatorDetails
                            .lastSuccessfulIngestionAtMs,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline font-medium">Quota: </dt>
                      <dd className="inline">
                        {inc.operatorDetails.quota
                          ? `${inc.operatorDetails.quota.dailyUsed}/${inc.operatorDetails.quota.dailyLimit} daily · ${inc.operatorDetails.quota.minuteUsed}/${inc.operatorDetails.quota.minuteLimit} minute`
                          : "not initialized"}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline font-medium">Circuit: </dt>
                      <dd className="inline">
                        {inc.operatorDetails.circuit
                          ? `${inc.operatorDetails.circuit.status} (${inc.operatorDetails.circuit.consecutiveFailures} failures)`
                          : "not initialized"}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="inline font-medium">
                        Freshness thresholds:{" "}
                      </dt>
                      <dd className="inline">
                        {inc.operatorDetails.thresholds.warningMs / 1_000}s
                        warning ·{" "}
                        {inc.operatorDetails.thresholds.criticalMs /
                          1_000}
                        s critical · delayed{" "}
                        {inc.operatorDetails.delayedForMs === null
                          ? "unknown"
                          : `${Math.floor(inc.operatorDetails.delayedForMs / 1_000)}s`}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="inline font-medium">
                        Latest exception:{" "}
                      </dt>
                      <dd className="inline">
                        {inc.operatorDetails.exception?.message ?? "none"}
                      </dd>
                    </div>
                  </dl>
                ) : null}
              </div>
              <div className="flex gap-2">
                {inc.status === "open" ? (
                  <button
                    type="button"
                    className="underline"
                    disabled={busyId === inc._id}
                    onClick={() => void withStepUp(inc._id, "ack")}
                  >
                    Acknowledge
                  </button>
                ) : null}
                {inc.status !== "resolved" ? (
                  <button
                    type="button"
                    className="underline"
                    disabled={busyId === inc._id}
                    onClick={() => void withStepUp(inc._id, "resolve")}
                  >
                    Resolve
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

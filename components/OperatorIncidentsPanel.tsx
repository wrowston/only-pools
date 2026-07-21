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
  summary: string;
};

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
                  {inc.type} · {inc.status}
                </div>
                <div className="text-zinc-500 dark:text-zinc-400">
                  {inc.summary}
                </div>
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

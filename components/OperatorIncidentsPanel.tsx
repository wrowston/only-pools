"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

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
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  const rows = (incidents ?? []) as IncidentRow[];

  return (
    <section
      className="mx-auto w-full max-w-3xl border-t border-zinc-200 px-6 py-8 dark:border-zinc-800"
      data-operator-incidents
    >
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        Operator Incidents
      </h2>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Production Operator recovery — step-up required for acknowledge and
        resolve. Deployment: {me.deploymentKind}
      </p>
      {error ? (
        <p className="mt-3 text-sm text-red-700 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      {incidents === undefined ? (
        <p className="mt-4 text-sm text-zinc-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">No open incidents.</p>
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

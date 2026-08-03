"use client";

import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";

function timestamp(value: number | null): string {
  return value === null ? "—" : new Date(value).toLocaleString();
}

function Metric(props: { label: string; value: string | number }) {
  return (
    <div className="border border-zinc-200 p-3 dark:border-zinc-700">
      <dt className="text-xs font-medium uppercase tracking-wide text-op-secondary">
        {props.label}
      </dt>
      <dd className="mt-1 text-lg font-semibold text-op-text">
        {props.value}
      </dd>
    </div>
  );
}

/** Aggregate-only provider state, visible only through the allowlisted query. */
export function OperatorProviderReliabilityPanel() {
  const status = useQuery(
    api.providerReliability.getOperatorProviderReliability,
  );
  if (status === undefined) {
    return (
      <section className="mx-auto w-full max-w-3xl px-6 py-8">
        <p className="text-sm text-op-secondary">
          Loading API-Sports reliability…
        </p>
      </section>
    );
  }

  return (
    <section
      className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-8"
      data-operator-provider-reliability
    >
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-op-text">
          API-Sports Reliability
        </h1>
        <p className="mt-1 text-sm text-op-secondary">
          Authoritative quota, circuit, deferral, and recovery state. Request
          details and credentials are not exposed.
        </p>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Daily usage"
          value={`${status.quota.dailyUsed} / ${status.quota.effectiveDailyLimit}`}
        />
        <Metric
          label="Protected remaining"
          value={`${status.quota.protectedReserveRemaining} / ${status.quota.protectedReserve}`}
        />
        <Metric
          label="Rolling minute"
          value={`${status.quota.rollingMinuteUsed} / ${status.quota.minuteLimit}`}
        />
        <Metric
          label="Circuit"
          value={status.circuit.status.replace("_", " ")}
        />
      </dl>

      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="border border-zinc-200 p-4 dark:border-zinc-700">
          <h2 className="font-semibold text-op-text">Quota window</h2>
          <p className="mt-2 text-op-secondary">
            Resets {timestamp(status.quota.dailyResetAtMs)}
          </p>
          <p className="text-op-secondary">
            Routine {status.quota.routineUsed} · protected{" "}
            {status.quota.protectedUsed}
          </p>
          <p className="text-op-secondary">
            Provider remaining: daily{" "}
            {status.quota.providerDailyRemaining ?? "unknown"} · minute{" "}
            {status.quota.providerMinuteRemaining ?? "unknown"}
          </p>
          <p className="text-op-secondary">
            Provider minute limit{" "}
            {status.quota.providerMinuteLimit ?? "unreported"}
          </p>
          <p className="text-op-secondary">
            Configured {status.quota.dailyLimit} · provider limit{" "}
            {status.quota.providerDailyLimit ?? "unreported"}
          </p>
        </div>
        <div className="border border-zinc-200 p-4 dark:border-zinc-700">
          <h2 className="font-semibold text-op-text">Circuit and recovery</h2>
          <p className="mt-2 text-op-secondary">
            Failures {status.circuit.consecutiveFailures} · generation{" "}
            {status.circuit.generation}
          </p>
          <p className="text-op-secondary">
            Open until {timestamp(status.circuit.openUntilMs)}
          </p>
          <p className="text-op-secondary">
            Probe lease {timestamp(status.circuit.probeExpiresAtMs)}
          </p>
          <p className="text-op-secondary">
            Recovery {status.recovery.status} · due{" "}
            {timestamp(status.recovery.dueAtMs)}
          </p>
        </div>
        <div className="border border-zinc-200 p-4 dark:border-zinc-700">
          <h2 className="font-semibold text-op-text">Deferred work</h2>
          <p className="mt-2 text-op-secondary">
            Routine {status.deferred.routineCount} · rejected{" "}
            {status.deferred.rejectedCount} · circuit blocked{" "}
            {status.deferred.circuitBlockedCount}
          </p>
          <p className="text-op-secondary">
            Last deferred {timestamp(status.deferred.lastDeferredAtMs)}
          </p>
          {status.deferred.active.slice(0, 3).map((item, index) => (
            <p
              className="text-op-secondary"
              key={`${item.surface}:${item.dueAtMs}:${index}`}
            >
              {item.surface} · {item.reason} · {timestamp(item.dueAtMs)}
            </p>
          ))}
        </div>
        <div className="border border-zinc-200 p-4 dark:border-zinc-700">
          <h2 className="font-semibold text-op-text">Header reconciliation</h2>
          <p className="mt-2 text-op-secondary">
            Inconsistent {status.quota.headerInconsistencyCount} · stale{" "}
            {status.quota.staleHeaderCount}
          </p>
          <p className="text-op-secondary">
            Last recovery {timestamp(status.circuit.recoveredAtMs)}
          </p>
        </div>
      </div>
    </section>
  );
}

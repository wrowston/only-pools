"use client";

import { useQuery } from "convex/react";
import { useState, type FormEvent } from "react";

import { api } from "@/convex/_generated/api";

export function OperatorProviderEvidencePanel() {
  const [draftStableKey, setDraftStableKey] = useState("");
  const [stableKey, setStableKey] = useState<string | null>(null);
  const evidence = useQuery(
    api.providerEvidence.listOperatorGameEvidence,
    stableKey ? { gameStableKey: stableKey, limit: 50 } : "skip",
  );

  function inspect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = draftStableKey.trim();
    if (/^[A-Za-z0-9:@._-]{1,180}$/.test(normalized)) {
      setStableKey(normalized);
    }
  }

  return (
    <section
      className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-8"
      data-operator-provider-evidence
    >
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-op-text">
          Provider Evidence
        </h1>
        <p className="mt-1 text-sm text-op-secondary">
          Inspect permanent normalized transitions and recent sanitized
          diagnostics for an NFL Game.
        </p>
      </div>
      <form className="flex flex-wrap gap-2" onSubmit={inspect}>
        <label className="min-w-64 flex-1 text-sm text-op-secondary">
          Stable game key
          <input
            className="mt-1 w-full border border-zinc-300 bg-transparent px-3 py-2 text-op-text dark:border-zinc-700"
            value={draftStableKey}
            onChange={(event) =>
              setDraftStableKey(event.currentTarget.value)
            }
            placeholder="nfl:2026:w1:kc@den"
            pattern="[A-Za-z0-9:@._-]{1,180}"
            required
          />
        </label>
        <button
          type="submit"
          className="op-btn op-btn-primary self-end"
        >
          Inspect
        </button>
      </form>
      {stableKey && evidence === undefined ? (
        <p className="text-sm text-op-secondary">Loading evidence…</p>
      ) : stableKey && evidence === null ? (
        <p className="text-sm text-op-secondary">
          No NFL Game matches that stable key.
        </p>
      ) : evidence ? (
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <div className="border border-zinc-200 p-4 dark:border-zinc-700">
            <h2 className="font-semibold text-op-text">
              Meaningful transitions ({evidence.permanent.length})
            </h2>
            {evidence.permanent.length === 0 ? (
              <p className="mt-2 text-op-secondary">
                No permanent transitions recorded.
              </p>
            ) : (
              <ul className="mt-2 space-y-2 text-xs text-op-secondary">
                {evidence.permanent.map((row) => (
                  <li key={row._id}>
                    {row.transitionKind} ·{" "}
                    {row.changedFields.join(", ")} ·{" "}
                    {row.after.lifecycle} · score{" "}
                    {row.after.awayScore ?? "—"}–
                    {row.after.homeScore ?? "—"} ·{" "}
                    {new Date(row.recordedAtMs).toLocaleString()}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="border border-zinc-200 p-4 dark:border-zinc-700">
            <h2 className="font-semibold text-op-text">
              Recent diagnostics ({evidence.diagnostics.length})
            </h2>
            {evidence.diagnostics.length === 0 ? (
              <p className="mt-2 text-op-secondary">
                No unexpired diagnostics recorded.
              </p>
            ) : (
              <ul className="mt-2 space-y-2 text-xs text-op-secondary">
                {evidence.diagnostics.map((row) => (
                  <li key={row._id}>
                    {row.outcome} · {row.endpoint} · seen{" "}
                    {row.observationCount}× · status{" "}
                    {row.providerStatus.short ??
                      (row.providerStatus.redacted
                        ? "redacted"
                        : "—")}{" "}
                    · response{" "}
                    {row.response.fingerprint?.slice(0, 12) ?? "—"} ·{" "}
                    {new Date(row.lastRecordedAtMs).toLocaleString()}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

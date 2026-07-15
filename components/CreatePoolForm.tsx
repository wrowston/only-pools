"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/convex/_generated/api";

type PoolType = "survivor" | "confidence";
type PickLockMode = "gameKickoff" | "weeklyCutoff";

export function CreatePoolForm({ onCancel }: { onCancel: () => void }) {
  const router = useRouter();
  const createPool = useMutation(api.pools.createPool);
  const startWeeks = useQuery(api.pools.listAvailableStartWeeks);
  const [name, setName] = useState("");
  const [type, setType] = useState<PoolType>("survivor");
  const [startWeek, setStartWeek] = useState<number | null>(null);
  const [pickLockMode, setPickLockMode] =
    useState<PickLockMode>("gameKickoff");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const weeks = startWeeks?.weeks ?? [];
  const effectiveStartWeek = startWeek ?? weeks[0] ?? null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (effectiveStartWeek === null) {
      setError("No valid Start Week is available yet.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await createPool({
        name,
        type,
        startWeek: effectiveStartWeek,
        pickLockMode,
      });
      router.push(`/pools/${result.poolId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create Pool");
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      className="flex flex-col gap-4 rounded-md border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        Create Pool
      </h2>
      {startWeeks?.seasonLabel ? (
        <p className="text-xs text-zinc-500">
          Pool Season: {startWeeks.seasonLabel} (immutable after create)
        </p>
      ) : null}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">
          Name
        </span>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
          placeholder="Sunday Best Friends"
        />
      </label>

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="font-medium text-zinc-700 dark:text-zinc-300">
          Pool Type
        </legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="type"
            checked={type === "survivor"}
            onChange={() => setType("survivor")}
          />
          Survivor
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="type"
            checked={type === "confidence"}
            onChange={() => setType("confidence")}
          />
          Confidence
        </label>
      </fieldset>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">
          Start Week
        </span>
        <select
          value={effectiveStartWeek ?? ""}
          onChange={(e) => setStartWeek(Number(e.target.value))}
          disabled={weeks.length === 0}
          className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
        >
          {weeks.length === 0 ? (
            <option value="">No weeks available</option>
          ) : (
            weeks.map((w) => (
              <option key={w} value={w}>
                Week {w}
              </option>
            ))
          )}
        </select>
      </label>

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="font-medium text-zinc-700 dark:text-zinc-300">
          Pick Lock mode
        </legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="pickLockMode"
            checked={pickLockMode === "gameKickoff"}
            onChange={() => setPickLockMode("gameKickoff")}
          />
          Game Kickoff Lock
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="pickLockMode"
            checked={pickLockMode === "weeklyCutoff"}
            onChange={() => setPickLockMode("weeklyCutoff")}
          />
          Weekly Cutoff Lock
        </label>
      </fieldset>

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={busy || weeks.length === 0}
          className="rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {busy ? "Creating…" : "Create Active Pool"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-900 dark:border-zinc-700 dark:text-zinc-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

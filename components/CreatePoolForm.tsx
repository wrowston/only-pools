"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

type PoolType = "survivor" | "confidence";
type PickLockMode = "gameKickoff" | "weeklyCutoff";
type ProposedRole = "member" | "admin";

type FormerParticipant = {
  participantId: Id<"participants">;
  displayName: string;
  formerRole: "admin" | "member";
};

export function CreatePoolForm({ onCancel }: { onCancel: () => void }) {
  const router = useRouter();
  const createPool = useMutation(api.pools.createPool);
  const createFromTemplate = useMutation(
    api.poolTemplates.createPoolFromTemplate,
  );
  const startWeeks = useQuery(api.pools.listAvailableStartWeeks);
  const templates = useQuery(api.poolTemplates.listMyTemplates);

  const [mode, setMode] = useState<"scratch" | "template">("scratch");
  const [templatePoolId, setTemplatePoolId] = useState<Id<"pools"> | "">("");
  const [name, setName] = useState("");
  const [type, setType] = useState<PoolType>("survivor");
  const [startWeek, setStartWeek] = useState<number | null>(null);
  const [pickLockMode, setPickLockMode] =
    useState<PickLockMode>("gameKickoff");
  const [inviteSelections, setInviteSelections] = useState<
    Record<string, ProposedRole | "skip">
  >({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdReturningUrls, setCreatedReturningUrls] = useState<
    Array<{
      displayName: string;
      role: ProposedRole;
      url: string;
      poolId: Id<"pools">;
    }>
  >([]);

  const weeks = startWeeks?.weeks ?? [];
  const weeksKey = weeks.join(",");
  const effectiveStartWeek = startWeek ?? weeks[0] ?? null;
  const selectedTemplate =
    templates?.find((t) => t.poolId === templatePoolId) ?? null;

  useEffect(() => {
    if (!selectedTemplate) return;
    setName(selectedTemplate.name);
    setType(selectedTemplate.type);
    setPickLockMode(selectedTemplate.pickLockMode);
    const preferred = selectedTemplate.startWeek;
    const availableWeeks = weeksKey
      ? weeksKey.split(",").map(Number)
      : [];
    setStartWeek(
      availableWeeks.includes(preferred)
        ? preferred
        : (availableWeeks[0] ?? null),
    );
    const next: Record<string, ProposedRole | "skip"> = {};
    for (const person of selectedTemplate.formerParticipants) {
      next[person.participantId] =
        person.formerRole === "admin" ? "admin" : "member";
    }
    setInviteSelections(next);
  }, [selectedTemplate, weeksKey]);

  function setInviteRole(
    participantId: Id<"participants">,
    value: ProposedRole | "skip",
  ) {
    setInviteSelections((prev) => ({ ...prev, [participantId]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (effectiveStartWeek === null) {
      setError("No valid Start Week is available yet.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "template") {
        if (!templatePoolId) {
          setError("Select a prior Pool to use as a template.");
          setBusy(false);
          return;
        }
        const returningInvites = (
          selectedTemplate?.formerParticipants ?? []
        )
          .map((person: FormerParticipant) => {
            const choice = inviteSelections[person.participantId] ?? "skip";
            if (choice === "skip") return null;
            return {
              participantId: person.participantId,
              proposedRole: choice,
            };
          })
          .filter((row): row is NonNullable<typeof row> => row !== null);

        const result = await createFromTemplate({
          sourcePoolId: templatePoolId,
          name,
          startWeek: effectiveStartWeek,
          pickLockMode,
          returningInvites,
        });

        const urls = result.returningInvites.map((invite) => {
          const person = selectedTemplate?.formerParticipants.find(
            (p) => p.participantId === invite.participantId,
          );
          return {
            displayName: person?.displayName ?? "Participant",
            role: invite.proposedRole,
            url: invite.url,
            poolId: result.poolId,
          };
        });
        if (urls.length > 0) {
          setCreatedReturningUrls(urls);
          setBusy(false);
          return;
        }
        router.push(`/pools/${result.poolId}`);
        return;
      }

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

  if (createdReturningUrls.length > 0) {
    const poolId = createdReturningUrls[0]!.poolId;
    return (
      <div className="flex flex-col gap-4 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Pool created — share Returning Participant Invites
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Nobody was enrolled automatically. Share each person-specific link;
          they must accept before joining.
        </p>
        <ul className="flex flex-col gap-3 text-sm">
          {createdReturningUrls.map((row) => (
            <li
              key={row.url}
              className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
            >
              <p className="font-medium text-zinc-800 dark:text-zinc-200">
                {row.displayName}{" "}
                <span className="font-normal text-zinc-500">
                  ({row.role === "admin" ? "proposed Admin" : "Member"})
                </span>
              </p>
              <code className="mt-1 block break-all text-xs text-zinc-600 dark:text-zinc-400">
                {row.url}
              </code>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => router.push(`/pools/${poolId}`)}
          className="rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Open Pool
        </button>
      </div>
    );
  }

  const templateOptions = templates ?? [];

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

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="font-medium text-zinc-700 dark:text-zinc-300">
          Setup
        </legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="createMode"
            checked={mode === "scratch"}
            onChange={() => setMode("scratch")}
          />
          New setup
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="createMode"
            checked={mode === "template"}
            onChange={() => setMode("template")}
            disabled={templateOptions.length === 0}
          />
          From template
          {templateOptions.length === 0 ? (
            <span className="text-xs text-zinc-500">
              (no prior Pools yet)
            </span>
          ) : null}
        </label>
      </fieldset>

      {mode === "template" ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            Prior Pool
          </span>
          <select
            value={templatePoolId}
            onChange={(e) =>
              setTemplatePoolId(
                e.target.value as Id<"pools"> | "",
              )
            }
            className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
            required
          >
            <option value="">Select a Pool Template…</option>
            {templateOptions.map((t) => (
              <option key={t.poolId} value={t.poolId}>
                {t.name} ({t.type}
                {t.seasonLabel ? ` · ${t.seasonLabel}` : ""})
              </option>
            ))}
          </select>
        </label>
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
            disabled={mode === "template"}
          />
          Survivor
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="type"
            checked={type === "confidence"}
            onChange={() => setType("confidence")}
            disabled={mode === "template"}
          />
          Confidence
        </label>
        {mode === "template" ? (
          <p className="text-xs text-zinc-500">
            Pool Type comes from the template and cannot change.
          </p>
        ) : null}
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

      {mode === "template" && selectedTemplate ? (
        <fieldset className="flex flex-col gap-3 text-sm">
          <legend className="font-medium text-zinc-700 dark:text-zinc-300">
            Returning Participant Invites (optional)
          </legend>
          <p className="text-xs text-zinc-500">
            Person-specific, single-use. Nobody is enrolled until they accept.
            Only you (Owner) may propose Admin.
          </p>
          {selectedTemplate.formerParticipants.length === 0 ? (
            <p className="text-xs text-zinc-500">
              No former participants to invite.
            </p>
          ) : (
            selectedTemplate.formerParticipants.map((person) => {
              const value = inviteSelections[person.participantId] ?? "skip";
              return (
                <label
                  key={person.participantId}
                  className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="text-zinc-800 dark:text-zinc-200">
                    {person.displayName}
                  </span>
                  <select
                    value={value}
                    onChange={(e) =>
                      setInviteRole(
                        person.participantId,
                        e.target.value as ProposedRole | "skip",
                      )
                    }
                    className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 dark:border-zinc-700"
                  >
                    <option value="skip">Don&apos;t invite</option>
                    <option value="member">Invite as Member</option>
                    <option value="admin">Invite as Admin</option>
                  </select>
                </label>
              );
            })
          )}
        </fieldset>
      ) : null}

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

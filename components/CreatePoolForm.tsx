"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { FieldInfo, FieldInfoTerm } from "@/components/FieldInfo";
import { convexErrorMessage } from "@/lib/convexErrorMessage";

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
      setError(convexErrorMessage(err, "Could not create Pool"));
      setBusy(false);
    }
  }

  if (createdReturningUrls.length > 0) {
    const poolId = createdReturningUrls[0]!.poolId;
    return (
      <div className="flex flex-col gap-4 op-panel p-5">
        <h2 className="text-lg font-semibold text-op-text">
          Pool created — share Returning Participant Invites
        </h2>
        <p className="text-sm text-op-secondary">
          Nobody was enrolled automatically. Share each person-specific link;
          they must accept before joining.
        </p>
        <ul className="flex flex-col gap-3 text-sm">
          {createdReturningUrls.map((row) => (
            <li
              key={row.url}
              className="rounded-[10px] border border-op-border bg-op-surface p-3"
            >
              <p className="font-medium text-op-text">
                {row.displayName}{" "}
                <span className="font-normal text-op-muted">
                  ({row.role === "admin" ? "proposed Admin" : "Member"})
                </span>
              </p>
              <code className="mt-1 block break-all text-xs text-op-secondary">
                {row.url}
              </code>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => router.push(`/pools/${poolId}`)}
          className="op-btn op-btn-primary"
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
      className="flex flex-col gap-4 op-panel p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-op-text">Create Pool</h2>
        <Link href="/guides/create-a-pool" className="text-xs font-medium text-op-selected-fg underline underline-offset-4">
          Creation guide
        </Link>
      </div>
      {startWeeks?.seasonLabel ? (
        <p className="text-xs text-op-muted">
          Pool Season: {startWeeks.seasonLabel} (immutable after create)
        </p>
      ) : null}

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="font-medium text-op-text">
          <span className="inline-flex items-center gap-1.5">
            Setup
            <FieldInfo label="Setup" title="Setup">
              <FieldInfoTerm term="New setup">
                Start a fresh Pool. You choose the name, Pool Type, Start
                Week, and Pick Lock mode yourself.
              </FieldInfoTerm>
              <FieldInfoTerm term="From template">
                Prefill from a prior Pool you owned — name, Pool Type, lock
                mode, Start Week preference, and optional returning-invite
                roles. Competitive history and standings do not carry over.
              </FieldInfoTerm>
            </FieldInfo>
          </span>
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
            <span className="text-xs text-op-muted">
              (no prior Pools yet)
            </span>
          ) : null}
        </label>
      </fieldset>

      {mode === "template" ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-op-text">
            Prior Pool
          </span>
          <select
            value={templatePoolId}
            onChange={(e) =>
              setTemplatePoolId(
                e.target.value as Id<"pools"> | "",
              )
            }
            className="rounded-md border border-op-border bg-op-surface"
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
        <span className="font-medium text-op-text">
          Name
        </span>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-md border border-op-border bg-op-surface"
          placeholder="Name your pool"
        />
      </label>

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="font-medium text-op-text">
          <span className="inline-flex items-center gap-1.5">
            Pool Type
            <FieldInfo label="Pool Type" title="Pool Type">
              <FieldInfoTerm term="Survivor">
                Each week, pick one NFL team. You stay alive only if that
                team wins. A loss, tie, or missing pick eliminates you. You
                cannot reuse a team you already picked.
              </FieldInfoTerm>
              <FieldInfoTerm term="Confidence">
                Each week, pick a winner for every required game and assign
                each pick a unique confidence value. Correct picks earn those
                points; the highest season total wins.
              </FieldInfoTerm>
              <p className="text-xs text-op-muted">
                Pool Type cannot change after create (or when using a
                template).
              </p>
            </FieldInfo>
          </span>
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
          <p className="text-xs text-op-muted">
            Pool Type comes from the template and cannot change.
          </p>
        ) : null}
      </fieldset>

      <label className="flex flex-col gap-1 text-sm">
        <span className="inline-flex items-center gap-1.5 font-medium text-op-text">
          Start Week
          <FieldInfo label="Start Week" title="Start Week">
            <p>
              The first NFL regular-season week your Pool includes. Only
              weeks whose first game has not kicked off yet are available.
            </p>
            <p>
              New members can join until that Start Week&apos;s earliest
              kickoff; after that, admission closes for good.
            </p>
          </FieldInfo>
        </span>
        <select
          value={effectiveStartWeek ?? ""}
          onChange={(e) => setStartWeek(Number(e.target.value))}
          disabled={weeks.length === 0}
          className="rounded-md border border-op-border bg-op-surface"
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
        <legend className="font-medium text-op-text">
          <span className="inline-flex items-center gap-1.5">
            Pick Lock mode
            <FieldInfo label="Pick Lock mode" title="Pick Lock mode">
              <p>
                Pick Lock is when a pick can no longer be submitted or
                changed. Locks are irreversible once reached.
              </p>
              <FieldInfoTerm term="Game Kickoff Lock">
                Each pick locks when its game&apos;s kickoff arrives (or
                play has started). Later unstarted games stay editable.
              </FieldInfoTerm>
              <FieldInfoTerm term="Weekly Cutoff Lock">
                Early games still lock at their own kickoff. Everything
                still open then locks together Sunday at 1:00&nbsp;p.m.
                Eastern — remaining Survivor/Confidence choices, confidence
                values, and the weekly tiebreaker.
              </FieldInfoTerm>
            </FieldInfo>
          </span>
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
          <legend className="font-medium text-op-text">
            Returning Participant Invites (optional)
          </legend>
          <p className="text-xs text-op-muted">
            Person-specific, single-use. Nobody is enrolled until they accept.
            Only you (Owner) may propose Admin.
          </p>
          {selectedTemplate.formerParticipants.length === 0 ? (
            <p className="text-xs text-op-muted">
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
                  <span className="text-op-text">
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
                    className="rounded-md border border-op-border bg-op-surface"
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
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={busy || weeks.length === 0}
          className="op-btn op-btn-primary"
        >
          {busy ? "Creating…" : "Create Active Pool"}
        </button>
        <button type="button" onClick={onCancel} className="op-btn op-btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}

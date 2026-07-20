"use client";

import posthog from "posthog-js";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Dialog } from "@/components/Dialog";
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

type PoolTemplate = {
  poolId: Id<"pools">;
  name: string;
  type: PoolType;
  pickLockMode: PickLockMode;
  maxEntriesPerUser: number | null;
  startWeek: number;
  seasonLabel?: string | null;
  formerParticipants: FormerParticipant[];
};

type CreatedPoolSuccess = {
  poolId: Id<"pools">;
  inviteUrl: string;
  expiresAtMs: number;
  returningInvites: Array<{
    displayName: string;
    role: ProposedRole;
    url: string;
  }>;
};

type WizardStep = 0 | 1 | 2;

const STEPS = [
  { id: 0 as const, label: "Basics" },
  { id: 1 as const, label: "Format" },
  { id: 2 as const, label: "Rules" },
] as const;

function absoluteInviteUrl(path: string): string {
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}

function resolveStartWeek(
  explicit: number | null,
  preferred: number | undefined,
  weeks: number[],
): number | null {
  if (explicit != null && weeks.includes(explicit)) return explicit;
  if (preferred != null && weeks.includes(preferred)) return preferred;
  return weeks[0] ?? null;
}

function defaultInviteSelections(
  formerParticipants: FormerParticipant[],
): Record<string, ProposedRole | "skip"> {
  const next: Record<string, ProposedRole | "skip"> = {};
  for (const person of formerParticipants) {
    next[person.participantId] =
      person.formerRole === "admin" ? "admin" : "member";
  }
  return next;
}

function WizardProgress({
  step,
  steps,
}: {
  step: WizardStep;
  steps: typeof STEPS;
}) {
  const labelId = useId();
  return (
    <div className="mb-5" aria-labelledby={labelId}>
      <p id={labelId} className="sr-only">
        Step {step + 1} of {steps.length}: {steps[step].label}
      </p>
      <ol className="flex items-center gap-1.5">
        {steps.map((s, index) => {
          const complete = index < step;
          const current = index === step;
          return (
            <li key={s.id} className="flex min-w-0 flex-1 items-center gap-1.5">
              <span
                className={[
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                  current
                    ? "bg-op-ink text-white"
                    : complete
                      ? "bg-op-selected text-op-selected-fg"
                      : "bg-op-control text-op-muted",
                ].join(" ")}
                aria-current={current ? "step" : undefined}
              >
                {complete ? "✓" : index + 1}
              </span>
              <span
                className={[
                  "truncate text-xs font-medium",
                  current ? "text-op-text" : "text-op-muted",
                ].join(" ")}
              >
                {s.label}
              </span>
              {index < steps.length - 1 ? (
                <span
                  className={[
                    "mx-1 h-px min-w-3 flex-1",
                    complete ? "bg-op-heat-20" : "bg-op-border",
                  ].join(" ")}
                  aria-hidden
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function CreatePoolWizard({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const createPool = useMutation(api.pools.createPool);
  const createFromTemplate = useMutation(
    api.poolTemplates.createPoolFromTemplate,
  );
  const startWeeks = useQuery(api.pools.listAvailableStartWeeks);
  const templates = useQuery(api.poolTemplates.listMyTemplates);

  const [step, setStep] = useState<WizardStep>(0);
  const [mode, setMode] = useState<"scratch" | "template">("scratch");
  const [templatePoolId, setTemplatePoolId] = useState<Id<"pools"> | "">("");
  const [name, setName] = useState("");
  const [type, setType] = useState<PoolType>("survivor");
  const [startWeek, setStartWeek] = useState<number | null>(null);
  const [pickLockMode, setPickLockMode] =
    useState<PickLockMode>("gameKickoff");
  const [maxEntriesPerUser, setMaxEntriesPerUser] = useState(1);
  const [inviteSelections, setInviteSelections] = useState<
    Record<string, ProposedRole | "skip">
  >({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedPoolSuccess | null>(null);
  const [copied, setCopied] = useState(false);

  const weeks = startWeeks?.weeks ?? [];
  const templateOptions = (templates ?? []) as PoolTemplate[];
  const selectedTemplate =
    templateOptions.find((t) => t.poolId === templatePoolId) ?? null;
  const effectiveStartWeek = resolveStartWeek(
    startWeek,
    selectedTemplate?.startWeek,
    weeks,
  );

  function applyTemplate(template: PoolTemplate) {
    setName(template.name);
    setType(template.type);
    setPickLockMode(template.pickLockMode);
    setMaxEntriesPerUser(template.maxEntriesPerUser ?? 1);
    setStartWeek(
      weeks.includes(template.startWeek) ? template.startWeek : null,
    );
    setInviteSelections(defaultInviteSelections(template.formerParticipants));
  }

  function setInviteRole(
    participantId: Id<"participants">,
    value: ProposedRole | "skip",
  ) {
    setInviteSelections((prev) => ({ ...prev, [participantId]: value }));
  }

  function validateStep(current: WizardStep): string | null {
    if (current === 0) {
      if (!name.trim()) return "Enter a name for your Pool.";
      if (mode === "template" && !templatePoolId) {
        return "Select a prior Pool to use as a template.";
      }
      return null;
    }
    if (current === 1) {
      if (effectiveStartWeek === null || weeks.length === 0) {
        return "No valid Start Week is available yet.";
      }
      return null;
    }
    return null;
  }

  function goNext() {
    const message = validateStep(step);
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    setStep((s) => (s < 2 ? ((s + 1) as WizardStep) : s));
  }

  function goBack() {
    setError(null);
    setStep((s) => (s > 0 ? ((s - 1) as WizardStep) : s));
  }

  async function copyShareLink() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.inviteUrl);
      setCopied(true);
      posthog.capture("invite_link_copied", { pool_id: created.poolId });
    } catch {
      setError("Could not copy link");
    }
  }

  async function onCreate() {
    const message = validateStep(2) ?? validateStep(1) ?? validateStep(0);
    if (message) {
      setError(message);
      return;
    }
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
        const returningInvites = (selectedTemplate?.formerParticipants ?? [])
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
          name: name.trim(),
          startWeek: effectiveStartWeek,
          pickLockMode,
          maxEntriesPerUser,
          returningInvites,
        });

        setCreated({
          poolId: result.poolId,
          inviteUrl: absoluteInviteUrl(result.inviteUrl),
          expiresAtMs: result.expiresAtMs,
          returningInvites: result.returningInvites.map((invite) => {
            const person = selectedTemplate?.formerParticipants.find(
              (p) => p.participantId === invite.participantId,
            );
            return {
              displayName: person?.displayName ?? "Participant",
              role: invite.proposedRole,
              url: absoluteInviteUrl(invite.url),
            };
          }),
        });
        posthog.capture("pool_created_from_template", {
          pool_id: result.poolId,
          pool_type: type,
          start_week: effectiveStartWeek,
          pick_lock_mode: pickLockMode,
        });
        setBusy(false);
        return;
      }

      const result = await createPool({
        name: name.trim(),
        type,
        startWeek: effectiveStartWeek,
        pickLockMode,
        maxEntriesPerUser,
      });
      setCreated({
        poolId: result.poolId,
        inviteUrl: absoluteInviteUrl(result.inviteUrl),
        expiresAtMs: result.expiresAtMs,
        returningInvites: [],
      });
      posthog.capture("pool_created", {
        pool_id: result.poolId,
        pool_type: type,
        start_week: effectiveStartWeek,
        pick_lock_mode: pickLockMode,
      });
      setBusy(false);
    } catch (err) {
      setError(convexErrorMessage(err, "Could not create Pool"));
      setBusy(false);
    }
  }

  const seasonDescription = startWeeks?.seasonLabel
    ? `Pool Season: ${startWeeks.seasonLabel} (immutable after create)`
    : undefined;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={created ? "Pool created" : "Create Pool"}
      size="lg"
      preventClose={busy}
      titleAccessory={
        created ? undefined : (
          <Link
            href="/guides/create-a-pool"
            className="text-xs font-medium text-op-selected-fg underline underline-offset-4"
          >
            Creation guide
          </Link>
        )
      }
      description={created ? undefined : seasonDescription}
    >
      {created ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-op-secondary">
            Share this link so others can join. Opening the link alone does not
            enroll anyone — they must accept.
          </p>
          <div className="flex flex-col gap-2 rounded-[10px] border border-op-border bg-op-canvas p-3">
            <code className="break-all text-xs text-op-text">
              {created.inviteUrl}
            </code>
            <p className="text-xs text-op-muted">
              Expires{" "}
              {new Intl.DateTimeFormat(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(created.expiresAtMs))}
            </p>
            <button
              type="button"
              onClick={() => void copyShareLink()}
              className="self-start text-sm font-medium text-op-text underline"
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          {created.returningInvites.length > 0 ? (
            <>
              <h3 className="text-sm font-semibold text-op-text">
                Returning Participant Invites
              </h3>
              <p className="text-sm text-op-secondary">
                Person-specific links. Nobody was enrolled automatically; each
                person must accept their own invite.
              </p>
              <ul className="flex flex-col gap-3 text-sm">
                {created.returningInvites.map((row) => (
                  <li
                    key={row.url}
                    className="rounded-[10px] border border-op-border bg-op-canvas p-3"
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
            </>
          ) : null}
          {error ? (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => {
              onClose();
              router.push(`/pools/${created.poolId}`);
            }}
            className="op-btn op-btn-primary"
          >
            View pool / Make picks
          </button>
        </div>
      ) : (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (step < 2) {
          goNext();
          return;
        }
        void onCreate();
      }}
      className="flex flex-col gap-1"
    >
      <WizardProgress step={step} steps={STEPS} />

      <div key={step} className="flex flex-col gap-4 op-wizard-step">
        {step === 0 ? (
          <>
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
                      Prefill from a prior Pool you owned — name, Pool Type,
                      lock mode, Start Week preference, and optional
                      returning-invite roles. Competitive history and standings
                      do not carry over.
                    </FieldInfoTerm>
                  </FieldInfo>
                </span>
              </legend>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="createMode"
                  checked={mode === "scratch"}
                  onChange={() => {
                    setMode("scratch");
                    setTemplatePoolId("");
                    setInviteSelections({});
                  }}
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
                <span className="font-medium text-op-text">Prior Pool</span>
                <select
                  value={templatePoolId}
                  onChange={(e) => {
                    const nextId = e.target.value as Id<"pools"> | "";
                    setTemplatePoolId(nextId);
                    const template = templateOptions.find(
                      (t) => t.poolId === nextId,
                    );
                    if (template) applyTemplate(template);
                  }}
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
              <span className="font-medium text-op-text">Name</span>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded-md border border-op-border bg-op-surface"
                placeholder="Name your pool"
                autoFocus
              />
            </label>
          </>
        ) : null}

        {step === 1 ? (
          <>
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
                      each pick a unique confidence value. Correct picks earn
                      those points; the highest season total wins.
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
          </>
        ) : null}

        {step === 2 ? (
          <>
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

            <label className="flex flex-col gap-1 text-sm">
              <span className="inline-flex items-center gap-1.5 font-medium text-op-text">
                Max entries per person
                <FieldInfo
                  label="Max entries per person"
                  title="Max entries per person"
                >
                  <p>
                    How many separate competitive entries each member may hold in
                    this Pool (1–10). Each entry has its own picks and standings
                    row.
                  </p>
                </FieldInfo>
              </span>
              <select
                value={maxEntriesPerUser}
                onChange={(e) => setMaxEntriesPerUser(Number(e.target.value))}
                className="rounded-md border border-op-border bg-op-surface"
              >
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>

            {mode === "template" && selectedTemplate ? (
              <fieldset className="flex flex-col gap-3 text-sm">
                <legend className="font-medium text-op-text">
                  Returning Participant Invites (optional)
                </legend>
                <p className="text-xs text-op-muted">
                  Person-specific, single-use. Nobody is enrolled until they
                  accept. Only you (Owner) may propose Admin.
                </p>
                {selectedTemplate.formerParticipants.length === 0 ? (
                  <p className="text-xs text-op-muted">
                    No former participants to invite.
                  </p>
                ) : (
                  selectedTemplate.formerParticipants.map((person) => {
                    const value =
                      inviteSelections[person.participantId] ?? "skip";
                    return (
                      <label
                        key={person.participantId}
                        className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <span className="text-op-text">{person.displayName}</span>
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

            <div className="rounded-[10px] border border-op-border bg-op-canvas px-3 py-2.5 text-xs text-op-secondary">
              <p className="font-medium text-op-text">
                {name.trim() || "Untitled pool"}
              </p>
              <p className="mt-0.5">
                {type === "survivor" ? "Survivor" : "Confidence"}
                {" · "}
                Week {effectiveStartWeek ?? "—"}
                {" · "}
                {pickLockMode === "gameKickoff"
                  ? "Game Kickoff Lock"
                  : "Weekly Cutoff Lock"}
                {" · "}
                {maxEntriesPerUser}{" "}
                {maxEntriesPerUser === 1 ? "entry" : "entries"} / person
              </p>
            </div>
          </>
        ) : null}
      </div>

      {error ? (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-op-border pt-4">
        <button
          type="button"
          onClick={step === 0 ? onClose : goBack}
          disabled={busy}
          className="op-btn op-btn-secondary"
        >
          {step === 0 ? "Cancel" : "Back"}
        </button>
        <div className="flex flex-wrap gap-2">
          {step < 2 ? (
            <button type="submit" className="op-btn op-btn-primary">
              Continue
            </button>
          ) : (
            <button
              type="submit"
              disabled={busy || weeks.length === 0}
              className="op-btn op-btn-primary"
            >
              {busy ? "Creating…" : "Create Active Pool"}
            </button>
          )}
        </div>
      </div>
    </form>
      )}
    </Dialog>
  );
}

export function CreatePoolDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // Unmount when closed so the next open starts with a clean wizard.
  if (!open) return null;
  return <CreatePoolWizard open={open} onClose={onClose} />;
}

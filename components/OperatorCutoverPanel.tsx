"use client";

import { useReverification } from "@clerk/nextjs";
import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { canOfferDevelopmentCleanActivation } from "@/lib/operatorCutover";

function JsonReport(props: { label: string; value: unknown }) {
  return (
    <details className="border border-op-border p-3">
      <summary className="cursor-pointer text-sm font-semibold text-op-text">
        {props.label}
      </summary>
      <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs text-op-secondary">
        {JSON.stringify(props.value, null, 2)}
      </pre>
    </details>
  );
}

/**
 * Development cutover workflow. Staging, confirmation request, and activation
 * remain separate authenticated operations; production activation is never
 * offered by this surface.
 */
export function OperatorCutoverPanel() {
  const [seasonYear, setSeasonYear] = useState(
    new Date().getUTCFullYear(),
  );
  const [stageId, setStageId] =
    useState<Id<"seasonBootstrapStages"> | null>(null);
  const [requestId, setRequestId] =
    useState<Id<"seasonBootstrapActivationRequests"> | null>(null);
  const [requiredConfirmation, setRequiredConfirmation] = useState("");
  const [typedConfirmation, setTypedConfirmation] = useState("");
  const [stepUpFresh, setStepUpFresh] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stageBootstrap = useAction(api.bootstrap.stageSeasonBootstrap);
  const requestActivation = useMutation(
    api.bootstrap.requestCleanSeasonActivation,
  );
  const activateBootstrap = useMutation(
    api.bootstrap.activateCleanSeasonBootstrap,
  );
  const verifyStepUp = useReverification(
    useAction(api.operatorStepUp.verifyProductionOperatorStepUp),
  );
  const stageReport = useQuery(
    api.bootstrap.getSeasonBootstrapStageReport,
    stageId ? { stageId } : "skip",
  );
  const activationReport = useQuery(
    api.bootstrap.getCleanSeasonActivationReport,
    requestId ? { requestId } : "skip",
  );
  const verification = useQuery(
    api.cutoverVerification.getOperatorCutoverVerification,
    Number.isSafeInteger(seasonYear) && seasonYear >= 2000
      ? { seasonYear }
      : "skip",
  );
  const developmentDeployment =
    canOfferDevelopmentCleanActivation(
      verification?.deployment.kind,
    );
  const stageEligible = stageReport?.activationEligible === true;
  const exactConfirmation =
    requiredConfirmation.length > 0 &&
    typedConfirmation === requiredConfirmation;

  async function perform(label: string, work: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(convexErrorMessage(cause, `Could not ${label}`));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-8"
      data-operator-cutover
    >
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-op-text">
          API-Sports Development Cutover
        </h1>
        <p className="mt-1 text-sm text-op-secondary">
          Stage and validate first, then request a deployment-bound clean
          activation confirmation. Activation is a separate exact-text action.
        </p>
      </div>

      <div className="border border-amber-400 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
        Production activation and Sync Gate enablement are prohibited here.
        Production remains blocked until a human-observed preseason
        qualification window passes.
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 border border-op-border p-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          NFL season year
          <input
            type="number"
            min={2000}
            max={2100}
            value={seasonYear}
            onChange={(event) => {
              setSeasonYear(Number(event.target.value));
              setStageId(null);
              setRequestId(null);
              setRequiredConfirmation("");
              setTypedConfirmation("");
            }}
          />
        </label>
        <button
          className="op-btn op-btn-secondary self-end"
          type="button"
          disabled={busy !== null || !Number.isSafeInteger(seasonYear)}
          onClick={() =>
            void perform("stage Season Bootstrap", async () => {
              const result = await stageBootstrap({ seasonYear });
              setStageId(result.stageId);
              setRequestId(null);
              setRequiredConfirmation("");
              setTypedConfirmation("");
            })
          }
        >
          Fetch and stage API-Sports
        </button>
      </div>

      {stageReport ? (
        <div className="grid gap-3 border border-op-border p-4 text-sm">
          <h2 className="font-semibold text-op-text">
            Durable staged report
          </h2>
          <p className="text-op-secondary">
            {stageReport.validationStatus} · {stageReport.counts.teams} teams ·{" "}
            {stageReport.counts.games} games · {stageReport.counts.weeks} weeks
          </p>
          <p className="text-op-secondary">
            Activation eligible: {stageReport.activationEligible ? "yes" : "no"}
          </p>
          {stageReport.failures.map((failure, index) => (
            <p
              className="text-red-700"
              key={`${failure.code}:${failure.entityKey ?? "season"}:${index}`}
            >
              {failure.code}: {failure.message}
            </p>
          ))}
          <JsonReport label="Staged report JSON" value={stageReport} />
        </div>
      ) : null}

      <div className="grid gap-3 border border-op-border p-4">
        <h2 className="font-semibold text-op-text">
          Separate clean activation confirmation
        </h2>
        <button
          className="op-btn op-btn-secondary"
          type="button"
          disabled={busy !== null}
          onClick={() =>
            void perform("complete Step-up Verification", async () => {
              await verifyStepUp({});
              setStepUpFresh(true);
            })
          }
        >
          {stepUpFresh ? "Step-up fresh" : "Complete Step-up Verification"}
        </button>
        <button
          className="op-btn op-btn-secondary"
          type="button"
          disabled={
            busy !== null ||
            !stageId ||
            !stageEligible ||
            !stepUpFresh ||
            !developmentDeployment
          }
          onClick={() =>
            void perform("request clean activation", async () => {
              const result = await requestActivation({
                stageId: stageId!,
                seasonYear,
              });
              setRequestId(result.requestId);
              setRequiredConfirmation(result.confirmationText);
              setTypedConfirmation("");
            })
          }
        >
          Request development activation confirmation
        </button>
        {requiredConfirmation ? (
          <>
            <p className="text-sm text-op-secondary">
              Type this deployment-bound phrase exactly:
            </p>
            <code className="break-all border border-op-border p-3 text-xs">
              {requiredConfirmation}
            </code>
            <label className="grid gap-1 text-sm">
              Exact confirmation
              <textarea
                rows={4}
                value={typedConfirmation}
                onChange={(event) =>
                  setTypedConfirmation(event.target.value)
                }
              />
            </label>
            <button
              className="op-btn op-btn-primary"
              type="button"
              disabled={
                busy !== null ||
                !requestId ||
                !stepUpFresh ||
                !developmentDeployment ||
                !exactConfirmation
              }
              onClick={() =>
                void perform("activate clean development dataset", async () => {
                  await activateBootstrap({
                    requestId: requestId!,
                    confirmationText: typedConfirmation,
                  });
                })
              }
            >
              Activate clean development dataset
            </button>
          </>
        ) : null}
      </div>

      {activationReport ? (
        <JsonReport
          label="Durable activation report"
          value={activationReport}
        />
      ) : null}

      <div className="grid gap-3 border border-op-border p-4 text-sm">
        <h2 className="font-semibold text-op-text">
          Read-only cutover verification
        </h2>
        {verification === undefined ? (
          <p className="text-op-secondary">Loading verification…</p>
        ) : (
          <>
            <p
              className={
                verification.status === "pass"
                  ? "text-green-700"
                  : "text-red-700"
              }
            >
              {verification.status.toUpperCase()} · development ready:{" "}
              {verification.developmentCutoverReady ? "yes" : "no"}
            </p>
            <ul className="grid gap-1">
              {verification.checks.map((item) => (
                <li key={item.id}>
                  <strong>{item.status.toUpperCase()}</strong> {item.id}:{" "}
                  {item.detail}
                </li>
              ))}
            </ul>
            <JsonReport
              label="Machine-readable verification JSON"
              value={verification}
            />
          </>
        )}
      </div>
    </section>
  );
}

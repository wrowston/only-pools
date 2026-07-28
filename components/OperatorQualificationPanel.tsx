"use client";

import { useReverification } from "@clerk/nextjs";
import { useAction, useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { convexErrorMessage } from "@/lib/convexErrorMessage";

const ATTESTATION =
  "I recorded every observed scoring change and final.";

export function OperatorQualificationPanel() {
  const seasons = useQuery(
    api.providerQualification.listQualificationSeasons,
  );
  const runs = useQuery(
    api.providerQualification.listOperatorQualificationRuns,
    { limit: 25 },
  );
  const [seasonId, setSeasonId] =
    useState<Id<"poolSeasons"> | null>(null);
  const [runId, setRunId] =
    useState<Id<"operatorAuditEvents"> | null>(null);
  const details = useQuery(
    api.providerQualification.getOperatorQualificationRun,
    runId ? { runId } : "skip",
  );
  const verifyStepUp = useReverification(
    useAction(api.operatorStepUp.verifyProductionOperatorStepUp),
  );
  const createRun = useMutation(
    api.providerQualification.createQualificationRun,
  );
  const registerGame = useMutation(
    api.providerQualification.registerQualificationGame,
  );
  const recordReference = useMutation(
    api.providerQualification.recordReferenceEvent,
  );
  const finalize = useMutation(
    api.providerQualification.finalizeQualificationRun,
  );
  const setSync = useMutation(
    api.providerQualification.setProductionCompetitiveSyncEnabled,
  );
  const poll = useAction(
    api.providerQualificationActions.pollQualificationGame,
  );

  const [home, setHome] = useState("DEN");
  const [away, setAway] = useState("KC");
  const [kickoff, setKickoff] = useState("");
  const [externalId, setExternalId] = useState("");
  const [gameKey, setGameKey] = useState<string | null>(null);
  const [homeScore, setHomeScore] = useState("");
  const [awayScore, setAwayScore] = useState("");
  const [kind, setKind] = useState<"score" | "final">("score");
  const [status, setStatus] = useState<"FT" | "AOT" | "CANC">("FT");
  const [explanation, setExplanation] = useState("");
  const [attested, setAttested] = useState(false);
  const [stepUpFresh, setStepUpFresh] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedRun = useMemo(
    () => runs?.find((run) => run._id === runId) ?? null,
    [runId, runs],
  );
  const isLatestForSeason =
    selectedRun !== null &&
    runs?.find((run) => run.seasonId === selectedRun.seasonId)?._id ===
      selectedRun._id;
  const qualificationStatus = !selectedRun
    ? null
    : selectedRun.status === "collecting"
      ? "Registered qualification window collecting. Production remains unqualified."
      : !isLatestForSeason
        ? "Stale decision: a later registered qualification window is authoritative."
        : selectedRun.status === "failed"
          ? "Unqualified. A later successful registered qualification window is required."
          : details !== undefined && !details?.isCurrentDecision
            ? "Stale decision: the Pool Season dataset or qualification policy changed."
          : details?.productionSyncEnabled
            ? "Current qualified decision. Production competitive sync is enabled."
            : "Current passing decision. Production sync remains disabled until explicitly enabled.";
  const registeredWindowLocked =
    (details?.references.length ?? 0) +
      (details?.providerEvents.length ?? 0) +
      (details?.candidateRejections.length ?? 0) >
    0;

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
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-op-text">
          API-Sports Qualification
        </h1>
        <p className="mt-1 text-sm text-op-secondary">
          Human-assisted soak evidence for one Pool Season. Production
          competitive sync remains off until the latest complete window passes.
        </p>
      </div>

      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}

      <div className="grid gap-3 rounded-md border border-op-border p-4">
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
        <label className="grid gap-1 text-sm">
          Pool Season
          <select
            value={seasonId ?? ""}
            onChange={(event) =>
              setSeasonId(
                event.target.value
                  ? (event.target.value as Id<"poolSeasons">)
                  : null,
              )
            }
          >
            <option value="">Select Pool Season</option>
            {seasons?.map((season) => (
              <option key={season.seasonId} value={season.seasonId}>
                {season.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="op-btn op-btn-primary"
          type="button"
          disabled={!seasonId || !stepUpFresh || busy !== null}
          onClick={() =>
            void perform("create qualification run", async () => {
              const created = await createRun({
                provider: "api-sports",
                seasonId: seasonId!,
              });
              setRunId(created.runId);
            })
          }
        >
          Start qualification window
        </button>
        <label className="grid gap-1 text-sm">
          Qualification window
          <select
            value={runId ?? ""}
            onChange={(event) =>
              setRunId(
                event.target.value
                  ? (event.target.value as Id<"operatorAuditEvents">)
                  : null,
              )
            }
          >
            <option value="">Select window</option>
            {runs?.map((run) => (
              <option key={run._id} value={run._id}>
                {run.seasonLabel} · generation {run.generation} · {run.status}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selectedRun ? (
        <>
          <div className="grid gap-3 rounded-md border border-op-border p-4 sm:grid-cols-2">
            <h2 className="font-semibold sm:col-span-2">
              Declare registered preseason test window
            </h2>
            <input aria-label="Home team" value={home} onChange={(e) => setHome(e.target.value.toUpperCase())} />
            <input aria-label="Away team" value={away} onChange={(e) => setAway(e.target.value.toUpperCase())} />
            <input aria-label="Scheduled kickoff" type="datetime-local" value={kickoff} onChange={(e) => setKickoff(e.target.value)} />
            <input aria-label="API-Sports candidate ID" placeholder="Optional API-Sports candidate ID" value={externalId} onChange={(e) => setExternalId(e.target.value)} />
            <button
              className="op-btn op-btn-secondary sm:col-span-2"
              type="button"
              disabled={
                selectedRun.status !== "collecting" ||
                registeredWindowLocked ||
                busy !== null
              }
              onClick={() =>
                void perform("register game", async () => {
                  await registerGame({
                    runId: selectedRun._id,
                    homeTeamAbbreviation: home as "DEN",
                    awayTeamAbbreviation: away as "KC",
                    scheduledKickoffMs: new Date(kickoff).getTime(),
                    apiSportsExternalId: externalId || undefined,
                  });
                })
              }
            >
              Add game to registered window
            </button>
          </div>

          <div className="grid gap-3 rounded-md border border-op-border p-4">
            <h2 className="font-semibold">Soak console</h2>
            <p className="text-sm text-op-secondary">
              The declared game list locks when the first reference or provider
              observation is recorded. Provider observations appear only in
              this qualification console and never mutate competitive NFL Games.
            </p>
            <select
              aria-label="Qualification game"
              value={gameKey ?? ""}
              onChange={(e) =>
                setGameKey(e.target.value || null)
              }
            >
              <option value="">Select registered game</option>
              {details?.games.map((game) => (
                <option value={game.stableKey} key={game.stableKey}>
                  {game.awayTeamAbbreviation} @ {game.homeTeamAbbreviation}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                className="op-btn op-btn-secondary"
                type="button"
                disabled={
                  !gameKey ||
                  selectedRun.status !== "collecting" ||
                  busy !== null
                }
                onClick={() =>
                  void perform("poll API-Sports", async () => {
                    await poll({
                      runId: selectedRun._id,
                      gameKey: gameKey!,
                    });
                  })
                }
              >
                Poll API-Sports
              </button>
              <select value={kind} onChange={(e) => setKind(e.target.value as "score" | "final")}>
                <option value="score">Score change</option>
                <option value="final">Final</option>
              </select>
            </div>
            <div className="flex gap-2">
              <input aria-label="Reference home score" type="number" min="0" value={homeScore} onChange={(e) => setHomeScore(e.target.value)} />
              <input aria-label="Reference away score" type="number" min="0" value={awayScore} onChange={(e) => setAwayScore(e.target.value)} />
              {kind === "final" ? (
                <select value={status} onChange={(e) => setStatus(e.target.value as "FT" | "AOT" | "CANC")}>
                  <option value="FT">FT</option>
                  <option value="AOT">AOT</option>
                  <option value="CANC">CANC</option>
                </select>
              ) : null}
            </div>
            <button
              className="op-btn op-btn-primary"
              type="button"
              disabled={
                !gameKey ||
                selectedRun.status !== "collecting" ||
                busy !== null
              }
              onClick={() => {
                const game = details?.games.find(
                  (item) => item.stableKey === gameKey,
                );
                if (!game) return;
                void perform("record official reference", async () => {
                  await recordReference({
                    runId: selectedRun._id,
                    gameKey: game.stableKey,
                    kind,
                    source: "official_nfl_view",
                    clientNonce: crypto.randomUUID(),
                    homeTeamAbbreviation: game.homeTeamAbbreviation as "DEN",
                    awayTeamAbbreviation: game.awayTeamAbbreviation as "KC",
                    homeScore: Number(homeScore),
                    awayScore: Number(awayScore),
                    status: kind === "final" ? status : undefined,
                  });
                });
              }}
            >
              Capture server-timestamped reference
            </button>
          </div>

          <div className="grid gap-3 rounded-md border border-op-border p-4">
            <h2 className="font-semibold">Report and production decision</h2>
            <p
              className="rounded border border-op-border px-3 py-2 text-sm"
              data-testid="qualification-current-status"
            >
              {qualificationStatus}
            </p>
            <p className="text-sm text-op-secondary">
              References {details?.references.length ?? 0} · missing games{" "}
              {selectedRun.missingGames ?? "pending"} · identity mismatches{" "}
              {selectedRun.identityMismatches ?? "pending"} · home/away reversals{" "}
              {selectedRun.homeAwayReversals ?? "pending"} · score errors{" "}
              {selectedRun.scoreErrors ?? "pending"} · final-status errors{" "}
              {selectedRun.finalStatusErrors ?? "pending"} · freshness breaches{" "}
              {selectedRun.freshnessBreaches ?? "pending"}
            </p>
            {selectedRun.coverageOverflowed ? (
              <p role="alert" className="text-sm text-red-700">
                Evidence capacity overflowed. This window cannot qualify; start
                a later registered qualification window.
              </p>
            ) : null}
            {details?.candidateRejections.map((rejection) => (
              <p
                role="alert"
                className="text-sm text-red-700"
                key={`${rejection.gameKey}:${rejection.code}`}
              >
                Rejected provider candidate · {rejection.code} ·{" "}
                {new Date(rejection.recordedAtMs).toLocaleString()}
              </p>
            ))}
            {selectedRun.findingsTruncated ? (
              <p className="text-sm text-amber-700">
                Detailed findings were truncated at the durable report limit;
                aggregate counters remain exact.
              </p>
            ) : null}
            {details?.references.map((reference) => (
              <p className="text-xs text-op-secondary" key={reference.sequence}>
                {reference.kind} · reference {reference.referenceAtMs ? new Date(reference.referenceAtMs).toLocaleString() : "missing"} ·
                ingestion {reference.providerIngestedAtMs ? new Date(reference.providerIngestedAtMs).toLocaleString() : "missing"} ·
                visible {reference.visibleAppliedAtMs ? new Date(reference.visibleAppliedAtMs).toLocaleString() : "missing"} ·
                ingestion delay {reference.ingestionDelayMs !== undefined ? `${reference.ingestionDelayMs} ms` : "missing"} ·
                application delay {reference.applicationDelayMs !== undefined ? `${reference.applicationDelayMs} ms` : "missing"} ·
                {reference.outcome ?? "pending"}
              </p>
            ))}
            {details?.findings.length ? (
              <ul className="grid gap-1 text-sm text-red-700">
                {details.findings.map((finding, index) => (
                  <li key={`${finding.code}:${finding.eventOrdinal ?? "run"}:${index}`}>
                    {finding.code}
                    {finding.gameOrdinal !== undefined
                      ? ` · game ${finding.gameOrdinal}`
                      : ""}
                    {finding.eventOrdinal !== undefined
                      ? ` · reference ${finding.eventOrdinal}`
                      : ""}
                    {" · "}
                    {finding.message}
                  </li>
                ))}
              </ul>
            ) : null}
            <textarea
              aria-label="Qualification explanation"
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              placeholder="Explain the evidence window and any failure."
            />
            <label className="flex gap-2 text-sm">
              <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
              {ATTESTATION}
            </label>
            <div className="flex gap-2">
              <button
                className="op-btn op-btn-secondary"
                type="button"
                disabled={!stepUpFresh || !attested || selectedRun.status !== "collecting" || busy !== null}
                onClick={() =>
                  void perform("finalize qualification", async () => {
                    await finalize({
                      runId: selectedRun._id,
                      explanation,
                      allObservedEventsRecorded: attested,
                      confirmationText: ATTESTATION,
                    });
                  })
                }
              >
                Finalize immutable report
              </button>
              <button
                className="op-btn op-btn-primary"
                type="button"
                disabled={
                  !stepUpFresh ||
                  selectedRun.status !== "passed" ||
                  details?.isCurrentDecision !== true ||
                  busy !== null
                }
                onClick={() =>
                  void perform("enable production sync", async () => {
                    await setSync({
                      enabled: true,
                      seasonId: selectedRun.seasonId,
                      provider: "api-sports",
                    });
                  })
                }
              >
                Enable production competitive sync
              </button>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}

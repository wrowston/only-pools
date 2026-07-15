/**
 * Sync Gate — application-level enable/disable for provider fetch work.
 * When OFF: new fetch claims are refused; locks and ordinary queries continue.
 */

export type SyncSurface = "schedule" | "live" | "confirmation" | "bootstrap";

export type SyncGateState = {
  enabled: boolean;
};

export type ClaimResult =
  | { ok: true; surface: SyncSurface }
  | { ok: false; reason: "sync_gate_off" };

export type DeploymentKind = "development" | "dev" | "production" | string;

/**
 * Production defaults ON after Season Bootstrap; Dev defaults OFF.
 */
export function defaultSyncGateEnabled(kind: DeploymentKind): boolean {
  return kind === "production";
}

export function resolveDeploymentKind(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): DeploymentKind {
  const explicit = env.DEPLOYMENT_KIND?.trim().toLowerCase();
  if (explicit) return explicit;
  // Heuristic: Convex cloud URLs for prod often lack "dev:" prefix in dashboard;
  // prefer explicit DEPLOYMENT_KIND. Fall back to development.
  return "development";
}

/**
 * Attempt to claim provider fetch work for a sync surface.
 * OFF refuses new claims only — callers keep serving locks/queries.
 */
export function canClaimProviderFetch(
  gate: SyncGateState,
  surface: SyncSurface,
): ClaimResult {
  if (!gate.enabled) {
    return { ok: false, reason: "sync_gate_off" };
  }
  return { ok: true, surface };
}

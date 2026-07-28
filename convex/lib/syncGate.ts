/**
 * Sync Gate — application-level enable/disable for provider fetch work.
 * When OFF: new fetch claims are refused; locks and ordinary queries continue.
 */

export type SyncSurface = "schedule" | "live" | "bootstrap";

export type SyncGateState = {
  enabled: boolean;
};

export type ClaimResult =
  | { ok: true; surface: SyncSurface }
  | { ok: false; reason: "sync_gate_off" };

export type DeploymentKind = "development" | "dev" | "production" | string;

/**
 * Competitive provider sync always starts OFF. Production requires a current
 * qualification decision before an explicit Operator enable.
 */
export function defaultSyncGateEnabled(kind: DeploymentKind): boolean {
  void kind;
  return false;
}

export function resolveDeploymentKind(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): DeploymentKind {
  return env.DEPLOYMENT_KIND?.trim().toLowerCase() ?? "";
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

import { describe, expect, it } from "vitest";
import {
  canClaimProviderFetch,
  defaultSyncGateEnabled,
  resolveDeploymentKind,
  type SyncGateState,
} from "./syncGate";

describe("Sync Gate claim helper (acceptance scenario 50)", () => {
  it("defaults OFF for development deployments", () => {
    expect(defaultSyncGateEnabled("development")).toBe(false);
    expect(defaultSyncGateEnabled("dev")).toBe(false);
  });

  it("defaults OFF for production until qualification explicitly enables it", () => {
    expect(defaultSyncGateEnabled("production")).toBe(false);
  });

  it("preserves missing, blank, and unknown deployment kinds for fail-closed callers", () => {
    expect(resolveDeploymentKind({})).toBe("");
    expect(resolveDeploymentKind({ DEPLOYMENT_KIND: "   " })).toBe("");
    expect(resolveDeploymentKind({ DEPLOYMENT_KIND: "Staging" })).toBe(
      "staging",
    );
  });

  it("refuses new provider fetch claims when Sync Gate is OFF", () => {
    const gate: SyncGateState = { enabled: false };
    expect(canClaimProviderFetch(gate, "schedule")).toEqual({
      ok: false,
      reason: "sync_gate_off",
    });
  });

  it("allows new provider fetch claims when Sync Gate is ON", () => {
    const gate: SyncGateState = { enabled: true };
    expect(canClaimProviderFetch(gate, "schedule")).toEqual({
      ok: true,
      surface: "schedule",
    });
  });
});

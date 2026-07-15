import { describe, expect, it } from "vitest";
import {
  canClaimProviderFetch,
  defaultSyncGateEnabled,
  type SyncGateState,
} from "./syncGate";

describe("Sync Gate claim helper (acceptance scenario 50)", () => {
  it("defaults OFF for development deployments", () => {
    expect(defaultSyncGateEnabled("development")).toBe(false);
    expect(defaultSyncGateEnabled("dev")).toBe(false);
  });

  it("defaults ON for production deployments", () => {
    expect(defaultSyncGateEnabled("production")).toBe(true);
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

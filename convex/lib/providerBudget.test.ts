import { describe, expect, it } from "vitest";
import {
  admitProviderFetch,
  emptyBudgetUsage,
  PROVIDER_BUDGET,
  recordAdmission,
  type BudgetUsage,
} from "./providerBudget";

describe("provider budget non-starvation (scenario 31)", () => {
  it("admits routine work up to the routine max", () => {
    let usage = emptyBudgetUsage();
    for (let i = 0; i < PROVIDER_BUDGET.routineMax; i++) {
      const decision = admitProviderFetch(usage, "routine");
      expect(decision.ok).toBe(true);
      usage = recordAdmission(usage, "routine");
    }
    expect(admitProviderFetch(usage, "routine")).toEqual({
      ok: false,
      reason: "routine_exhausted",
    });
  });

  it("routine cannot consume recovery or operator reserves", () => {
    let usage: BudgetUsage = {
      routine: PROVIDER_BUDGET.routineMax,
      recovery: 0,
      operator: 0,
    };
    expect(admitProviderFetch(usage, "routine").ok).toBe(false);

    // Protected reserves remain available for recovery / operator work.
    expect(admitProviderFetch(usage, "recovery")).toEqual({
      ok: true,
      priority: "recovery",
    });
    expect(admitProviderFetch(usage, "operator")).toEqual({
      ok: true,
      priority: "operator",
    });

    // Fill recovery reserve — still cannot be taken by routine.
    for (let i = 0; i < PROVIDER_BUDGET.recoveryReserve; i++) {
      usage = recordAdmission(usage, "recovery");
    }
    expect(admitProviderFetch(usage, "routine").ok).toBe(false);
    // Routine saturated + recovery reserve full → recovery exhausted.
    expect(admitProviderFetch(usage, "recovery")).toEqual({
      ok: false,
      reason: "recovery_exhausted",
    });
  });

  it("recovery may borrow unused routine capacity", () => {
    const usage = emptyBudgetUsage();
    // With unused routine, recovery can exceed its 10-request reserve.
    let u = usage;
    for (let i = 0; i < PROVIDER_BUDGET.recoveryReserve + 5; i++) {
      const d = admitProviderFetch(u, "recovery");
      expect(d.ok).toBe(true);
      u = recordAdmission(u, "recovery");
    }
    expect(u.recovery).toBe(PROVIDER_BUDGET.recoveryReserve + 5);
  });

  it("when routine is saturated, recovery still has its reserve", () => {
    let usage = emptyBudgetUsage();
    for (let i = 0; i < PROVIDER_BUDGET.routineMax; i++) {
      usage = recordAdmission(usage, "routine");
    }
    for (let i = 0; i < PROVIDER_BUDGET.recoveryReserve; i++) {
      const d = admitProviderFetch(usage, "recovery");
      expect(d.ok).toBe(true);
      usage = recordAdmission(usage, "recovery");
    }
    expect(admitProviderFetch(usage, "recovery")).toEqual({
      ok: false,
      reason: "recovery_exhausted",
    });
    // Operator reserve still protected.
    expect(admitProviderFetch(usage, "operator").ok).toBe(true);
  });
});

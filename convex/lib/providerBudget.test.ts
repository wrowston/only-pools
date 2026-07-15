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

  it("routine cannot consume confirmation or operator reserves", () => {
    let usage: BudgetUsage = {
      routine: PROVIDER_BUDGET.routineMax,
      confirmation: 0,
      operator: 0,
    };
    expect(admitProviderFetch(usage, "routine").ok).toBe(false);

    // Reserves remain available for confirmation / operator.
    expect(admitProviderFetch(usage, "confirmation")).toEqual({
      ok: true,
      priority: "confirmation",
    });
    expect(admitProviderFetch(usage, "operator")).toEqual({
      ok: true,
      priority: "operator",
    });

    // Fill confirmation reserve — still cannot be taken by routine.
    for (let i = 0; i < PROVIDER_BUDGET.confirmationReserve; i++) {
      usage = recordAdmission(usage, "confirmation");
    }
    expect(admitProviderFetch(usage, "routine").ok).toBe(false);
    // Routine saturated + confirmation reserve full → confirmation exhausted.
    expect(admitProviderFetch(usage, "confirmation")).toEqual({
      ok: false,
      reason: "confirmation_exhausted",
    });
  });

  it("confirmation may borrow unused routine capacity", () => {
    const usage = emptyBudgetUsage();
    // With unused routine, confirmation can exceed its 10 reserve.
    let u = usage;
    for (let i = 0; i < PROVIDER_BUDGET.confirmationReserve + 5; i++) {
      const d = admitProviderFetch(u, "confirmation");
      expect(d.ok).toBe(true);
      u = recordAdmission(u, "confirmation");
    }
    expect(u.confirmation).toBe(PROVIDER_BUDGET.confirmationReserve + 5);
  });

  it("when routine is saturated, confirmation still has its reserve", () => {
    let usage = emptyBudgetUsage();
    for (let i = 0; i < PROVIDER_BUDGET.routineMax; i++) {
      usage = recordAdmission(usage, "routine");
    }
    for (let i = 0; i < PROVIDER_BUDGET.confirmationReserve; i++) {
      const d = admitProviderFetch(usage, "confirmation");
      expect(d.ok).toBe(true);
      usage = recordAdmission(usage, "confirmation");
    }
    expect(admitProviderFetch(usage, "confirmation")).toEqual({
      ok: false,
      reason: "confirmation_exhausted",
    });
    // Operator reserve still protected.
    expect(admitProviderFetch(usage, "operator").ok).toBe(true);
  });
});

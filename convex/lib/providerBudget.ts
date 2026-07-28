/**
 * Provider-wide rolling request budget (settled: 60 req/min).
 *
 * - 40 for routine schedule / live work
 * - 10 protected for correction / recovery work
 * - 10 reserved for Production Operator work
 *
 * Routine work cannot consume either reserve. Higher-priority work may borrow
 * unused routine capacity.
 */

export type BudgetPriority = "routine" | "recovery" | "operator";

export const PROVIDER_BUDGET = {
  totalPerMinute: 60,
  routineMax: 40,
  recoveryReserve: 10,
  operatorReserve: 10,
} as const;

export type BudgetUsage = {
  routine: number;
  recovery: number;
  operator: number;
};

export type BudgetDecision =
  | { ok: true; priority: BudgetPriority }
  | {
      ok: false;
      reason:
        | "routine_exhausted"
        | "recovery_exhausted"
        | "operator_exhausted"
        | "total_exhausted";
    };

export function emptyBudgetUsage(): BudgetUsage {
  return { routine: 0, recovery: 0, operator: 0 };
}

function totalUsed(usage: BudgetUsage): number {
  return usage.routine + usage.recovery + usage.operator;
}

/**
 * Admit one provider fetch under the rolling budget.
 * Recovery/operator reserves are protected from routine starvation.
 */
export function admitProviderFetch(
  usage: BudgetUsage,
  priority: BudgetPriority,
): BudgetDecision {
  if (totalUsed(usage) >= PROVIDER_BUDGET.totalPerMinute) {
    return { ok: false, reason: "total_exhausted" };
  }

  if (priority === "routine") {
    if (usage.routine >= PROVIDER_BUDGET.routineMax) {
      return { ok: false, reason: "routine_exhausted" };
    }
    // Routine cannot borrow recovery/operator reserves — only its own 40.
    return { ok: true, priority: "routine" };
  }

  if (priority === "recovery") {
    const recoverySlotsUsed = usage.recovery;
    const unusedRoutine = Math.max(
      0,
      PROVIDER_BUDGET.routineMax - usage.routine,
    );
    const recoveryCapacity = PROVIDER_BUDGET.recoveryReserve + unusedRoutine;
    if (recoverySlotsUsed >= recoveryCapacity) {
      return { ok: false, reason: "recovery_exhausted" };
    }
    return { ok: true, priority: "recovery" };
  }

  // operator
  const unusedRoutine = Math.max(0, PROVIDER_BUDGET.routineMax - usage.routine);
  const unusedRecovery = Math.max(
    0,
    PROVIDER_BUDGET.recoveryReserve - usage.recovery,
  );
  const operatorCapacity =
    PROVIDER_BUDGET.operatorReserve + unusedRoutine + unusedRecovery;
  if (usage.operator >= operatorCapacity) {
    return { ok: false, reason: "operator_exhausted" };
  }
  return { ok: true, priority: "operator" };
}

export function recordAdmission(
  usage: BudgetUsage,
  priority: BudgetPriority,
): BudgetUsage {
  return { ...usage, [priority]: usage[priority] + 1 };
}

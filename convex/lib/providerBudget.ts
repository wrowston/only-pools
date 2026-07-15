/**
 * Provider-wide rolling request budget (settled: 60 req/min).
 *
 * - 40 for routine schedule / live work
 * - 10 reserved for confirmation / correction / recovery
 * - 10 reserved for Production Operator work
 *
 * Routine work cannot consume either reserve. Higher-priority work may borrow
 * unused routine capacity.
 */

export type BudgetPriority = "routine" | "confirmation" | "operator";

export const PROVIDER_BUDGET = {
  totalPerMinute: 60,
  routineMax: 40,
  confirmationReserve: 10,
  operatorReserve: 10,
} as const;

export type BudgetUsage = {
  routine: number;
  confirmation: number;
  operator: number;
};

export type BudgetDecision =
  | { ok: true; priority: BudgetPriority }
  | {
      ok: false;
      reason: "routine_exhausted" | "confirmation_exhausted" | "operator_exhausted" | "total_exhausted";
    };

export function emptyBudgetUsage(): BudgetUsage {
  return { routine: 0, confirmation: 0, operator: 0 };
}

function totalUsed(usage: BudgetUsage): number {
  return usage.routine + usage.confirmation + usage.operator;
}

/**
 * Admit one provider fetch under the rolling budget.
 * Confirmation/operator reserves are protected from routine starvation.
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
    // Routine cannot borrow confirmation/operator reserves — only its own 40.
    return { ok: true, priority: "routine" };
  }

  if (priority === "confirmation") {
    const confirmationSlotsUsed = usage.confirmation;
    const unusedRoutine = Math.max(
      0,
      PROVIDER_BUDGET.routineMax - usage.routine,
    );
    const confirmationCapacity =
      PROVIDER_BUDGET.confirmationReserve + unusedRoutine;
    if (confirmationSlotsUsed >= confirmationCapacity) {
      return { ok: false, reason: "confirmation_exhausted" };
    }
    return { ok: true, priority: "confirmation" };
  }

  // operator
  const unusedRoutine = Math.max(0, PROVIDER_BUDGET.routineMax - usage.routine);
  const unusedConfirmation = Math.max(
    0,
    PROVIDER_BUDGET.confirmationReserve - usage.confirmation,
  );
  const operatorCapacity =
    PROVIDER_BUDGET.operatorReserve + unusedRoutine + unusedConfirmation;
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

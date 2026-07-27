import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import { internal } from "../../_generated/api";
import type { ActionCtx } from "../../_generated/server";
import {
  deterministicRetryJitterUnit,
  type ProviderAdmissionReceipt,
  type ProviderTraffic,
} from "../../lib/providerReliabilityPolicy";
import {
  quotaFromHeaders,
  type ApiSportsRequestFence,
} from "./client";

type AdmissionDenial = Readonly<{
  reason: string;
  retryAtMs: number;
}>;

class ApiSportsAdmissionDenied extends Data.TaggedError(
  "ApiSportsAdmissionDenied",
)<AdmissionDenial> {
  override get message(): string {
    return `API-Sports admission denied: ${this.reason}`;
  }
}

class ApiSportsReliabilityBoundaryError extends Data.TaggedError(
  "ApiSportsReliabilityBoundaryError",
)<{ phase: "quota_reconciliation" }> {}

export function isApiSportsQuotaError(error: unknown): boolean {
  return (
    (typeof error === "object" &&
      error !== null &&
      "_tag" in error &&
      error._tag === "ApiSportsRateLimitError") ||
    /rate.?limit|quota|too many requests/i.test(String(error))
  );
}

/**
 * Effect-native hooks yielded by the API client around each physical fetch.
 * The owning action executes the resulting provider Effect exactly once.
 */
export function createReliableApiSportsFetch(input: {
  ctx: Pick<ActionCtx, "runMutation">;
  surface: string;
  traffic: ProviderTraffic;
  nowMs?: () => number;
  jitterKey?: string;
}) {
  const nowMs = input.nowMs ?? Date.now;
  let lastReceipt: ProviderAdmissionReceipt | null = null;
  let lastDenial: AdmissionDenial | null = null;
  let sawRateLimit = false;
  let quotaRetryAtMs: number | null = null;
  let boundaryFailure = false;

  const fence: ApiSportsRequestFence = {
    beforeRequest: () =>
      Effect.gen(function* () {
        const admission = yield* Effect.promise(() =>
          input.ctx.runMutation(
            internal.providerReliability.admitApiSportsRequest,
            {
              traffic: input.traffic,
              surface: input.surface,
              nowMs: nowMs(),
            },
          ),
        );
        if (!admission.ok) {
          lastDenial = {
            reason: admission.reason,
            retryAtMs: admission.retryAtMs,
          };
          return yield* new ApiSportsAdmissionDenied(lastDenial);
        }
        lastReceipt = admission.receipt;
        return admission.receipt;
      }),
    afterResponse: (admission, response) =>
      Effect.gen(function* () {
        const receipt = admission as ProviderAdmissionReceipt;
        if (response.status === 429) sawRateLimit = true;
        const reconciliation = yield* Effect.tryPromise({
          try: () =>
            input.ctx.runMutation(
              internal.providerReliability.reconcileApiSportsQuota,
              {
                receipt,
                nowMs: nowMs(),
                ...quotaFromHeaders(response.headers),
              },
            ),
          catch: () => {
            boundaryFailure =
              response.ok && response.status !== 429;
            return new ApiSportsReliabilityBoundaryError({
              phase: "quota_reconciliation",
            });
          },
        });
        quotaRetryAtMs = reconciliation.quotaRetryAtMs;
      }),
  };

  return {
    fence,
    latestReceipt: () => lastReceipt,
    denial: () => lastDenial,
    sawRateLimit: () => sawRateLimit,
    recordOutcome: async (outcome: {
      success: boolean;
      attempt: number;
      nowMs: number;
      error?: unknown;
      failureReason?: string;
      randomUnit?: number;
    }) => {
      if (!outcome.success && lastDenial !== null) {
        return {
          retryAtMs: lastDenial.retryAtMs,
          recorded: false,
          deferredReason: lastDenial.reason,
        };
      }
      if (!outcome.success && boundaryFailure) {
        return {
          retryAtMs: outcome.nowMs + 60_000,
          recorded: false,
          deferredReason: "provider_reliability_boundary_failed",
        };
      }
      if (lastReceipt === null) {
        return {
          retryAtMs: lastDenial?.retryAtMs ?? outcome.nowMs + 60_000,
          recorded: false,
          deferredReason: lastDenial?.reason,
        };
      }
      if (
        !outcome.success &&
        (sawRateLimit || isApiSportsQuotaError(outcome.error))
      ) {
        return {
          retryAtMs: quotaRetryAtMs ?? outcome.nowMs + 60_000,
          recorded: false,
          deferredReason: "provider_rate_limited",
        };
      }
      const result = await input.ctx.runMutation(
        internal.providerReliability.recordApiSportsOutcome,
        {
          success: outcome.success,
          surface: input.surface,
          nowMs: outcome.nowMs,
          attempt: outcome.attempt,
          randomUnit:
            outcome.randomUnit ??
            deterministicRetryJitterUnit(
              `${input.jitterKey ?? input.surface}:${outcome.attempt}`,
            ),
          receipt: lastReceipt,
          failureReason: outcome.success
            ? undefined
            : outcome.failureReason ?? "provider_failure",
        },
      );
      return {
        ...result,
        recorded: true,
        deferredReason: undefined,
      };
    },
  };
}

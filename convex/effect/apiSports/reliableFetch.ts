import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import type { ActionCtx } from "../../_generated/server";
import type { ProductionQualificationFence } from "../../providerQualification";
import {
  deterministicRetryJitterUnit,
  type ProviderAdmissionReceipt,
  type ProviderTraffic,
} from "../../lib/providerReliabilityPolicy";
import {
  sanitizeRequestMetadata,
  summarizeProviderResponse,
} from "../../lib/providerEvidencePolicy";
import {
  quotaFromHeaders,
  type ApiSportsRequestFence,
  type ApiSportsRequestMetadata,
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
  surface:
    | "bootstrap"
    | "schedule"
    | "live"
    | "correction"
    | "operator";
  traffic: ProviderTraffic;
  nowMs?: () => number;
  jitterKey?: string;
  scopeKey?: string;
  gameId?: Id<"nflGames">;
  intent?: "competitive" | "qualification" | "bootstrap" | "health";
  qualificationRunId?: Id<"operatorAuditEvents">;
  expectedSeasonId?: Id<"poolSeasons">;
}) {
  const nowMs = input.nowMs ?? Date.now;
  let lastReceipt: ProviderAdmissionReceipt | null = null;
  let lastDenial: AdmissionDenial | null = null;
  let sawRateLimit = false;
  let quotaRetryAtMs: number | null = null;
  let boundaryFailure = false;
  let productionFence: ProductionQualificationFence | null = null;
  const responseDetails = new WeakMap<
    Response,
    Readonly<{
      summary: {
        bodyBytes: number;
        bodyDigest: string;
        resultCount: number | null;
        pagingCurrent: number | null;
        pagingTotal: number | null;
      };
      quota: {
        dailyLimit: number | null;
        dailyRemaining: number | null;
        minuteLimit: number | null;
        minuteRemaining: number | null;
      };
    }>
  >();

  const recordDiagnostic = async (diagnostic: {
    request: ApiSportsRequestMetadata;
    outcome:
      | "success"
      | "http_error"
      | "rate_limited"
      | "transport_error"
      | "malformed"
      | "quarantined";
    response?: Response;
  }): Promise<void> => {
    const request = sanitizeRequestMetadata(diagnostic.request);
    let responseSummary:
      | {
          bodyBytes: number;
          bodyDigest: string;
          resultCount: number | null;
          pagingCurrent: number | null;
          pagingTotal: number | null;
        }
      | undefined;
    let quota:
      | {
          dailyLimit: number | null;
          dailyRemaining: number | null;
          minuteLimit: number | null;
          minuteRemaining: number | null;
        }
      | undefined;
    if (diagnostic.response) {
      const captured = responseDetails.get(diagnostic.response);
      if (captured) {
        responseSummary = captured.summary;
        quota = captured.quota;
      }
    }
    await input.ctx.runMutation(
      internal.providerEvidence.recordApiSportsDiagnostic,
      {
        surface: input.surface,
        scopeKey: input.scopeKey,
        gameId: input.gameId,
        endpoint: request.endpoint,
        parameters: request.parameters,
        outcome: diagnostic.outcome,
        httpStatus: diagnostic.response?.status,
        responseSummary,
        quota,
      },
    );
  };

  const fence: ApiSportsRequestFence = {
    beforeRequest: () =>
      Effect.gen(function* () {
        const intent =
          input.intent ??
          (input.surface === "bootstrap"
            ? "bootstrap"
            : input.surface === "operator"
              ? "health"
              : "competitive");
        const explicitDevelopment =
          process.env.DEPLOYMENT_KIND?.trim().toLowerCase() ===
            "development" ||
          process.env.DEPLOYMENT_KIND?.trim().toLowerCase() === "dev";
        const authorization = explicitDevelopment
          ? { allowed: true as const, fence: null }
          : yield* Effect.promise(() =>
              input.ctx.runMutation(
                internal.providerQualification
                  .authorizeProductionProviderRequest,
                {
                  intent,
                  qualificationRunId: input.qualificationRunId,
                  expectedSeasonId: input.expectedSeasonId,
                },
              ),
            );
        if (!authorization.allowed) {
          lastDenial = {
            reason: authorization.reason,
            retryAtMs: nowMs() + 60_000,
          };
          return yield* new ApiSportsAdmissionDenied(lastDenial);
        }
        productionFence =
          authorization.fence as ProductionQualificationFence | null;
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
    afterResponse: (admission, response, request) =>
      Effect.tryPromise({
        try: async () => {
        const receipt = admission as ProviderAdmissionReceipt;
        if (response.status === 429) sawRateLimit = true;
        try {
          const body = await response.clone().text();
          const summary = await summarizeProviderResponse(
            body,
            response.headers.get("content-type"),
          );
          responseDetails.set(response, {
            summary: {
              bodyBytes: summary.bodyBytes,
              bodyDigest: summary.bodyDigest,
              resultCount: summary.resultCount,
              pagingCurrent: summary.pagingCurrent,
              pagingTotal: summary.pagingTotal,
            },
            quota: quotaFromHeaders(response.headers),
          });
        } catch {
          // Missing body diagnostics never changes provider request authority.
        }
        let reconciliation;
        try {
          reconciliation = await input.ctx.runMutation(
              internal.providerReliability.reconcileApiSportsQuota,
              {
                receipt,
                nowMs: nowMs(),
                ...quotaFromHeaders(response.headers),
              },
            );
        } catch {
          boundaryFailure = response.ok && response.status !== 429;
          try {
            await recordDiagnostic({
              request,
              response,
              outcome: "quarantined",
            });
          } catch {
            // Diagnostics are best-effort and never change request authority.
          }
          throw new ApiSportsReliabilityBoundaryError({
            phase: "quota_reconciliation",
          });
        }
        quotaRetryAtMs = reconciliation.quotaRetryAtMs;
        },
        catch: (error) =>
          error instanceof ApiSportsReliabilityBoundaryError
            ? error
            : new ApiSportsReliabilityBoundaryError({
                phase: "quota_reconciliation",
              }),
      }),
    afterError: (_admission, request) =>
      Effect.promise(async () => {
        try {
          await recordDiagnostic({
            request,
            outcome: "transport_error",
          });
        } catch {
          // Diagnostics are best-effort and never change request authority.
        }
      }),
    afterOutcome: (_admission, response, request, outcome) =>
      Effect.promise(async () => {
        try {
          await recordDiagnostic({
            request,
            response,
            outcome,
          });
        } catch {
          // Diagnostics are best-effort and never change request authority.
        }
      }),
  };

  return {
    fence,
    latestReceipt: () => lastReceipt,
    productionFence: () => productionFence,
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

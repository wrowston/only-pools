import { describe, expect, it, vi } from "vitest";

import { createReliableApiSportsFetch } from "../../effect/apiSports/reliableFetch";
import { createApiSportsClient } from "../../effect/apiSports/client";
import { runEffect } from "../../effect/run";

function statusResponse(
  init: ResponseInit = { status: 200 },
): Response {
  return new Response(
    JSON.stringify({
      errors: [],
      response: { requests: { current: 1, limit_day: 7_500 } },
    }),
    init,
  );
}

describe("reliable API-Sports fetch boundary", () => {
  it("admits and reconciles every physical request independently", async () => {
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        receipt: {
          dailyWindowStartedAtMs: 1,
          providerMinuteWindowStartedAtMs: 2,
          circuitGeneration: 3,
          probeToken: null,
        },
      })
      .mockResolvedValueOnce({});
    const fetch = vi.fn().mockResolvedValue(
      statusResponse({
        status: 200,
        headers: {
          "x-ratelimit-requests-limit": "7500",
          "x-ratelimit-requests-remaining": "7499",
          "x-ratelimit-limit": "60",
          "x-ratelimit-remaining": "59",
        },
      }),
    );
    const controller = createReliableApiSportsFetch({
      ctx: { runMutation } as never,
      surface: "schedule",
      traffic: "routine",
      nowMs: () => 10,
    });
    const client = createApiSportsClient({
      apiKey: "test-key",
      fetch,
      requestFence: controller.fence,
      nowMs: () => 10,
    });
    await runEffect(client.fetchStatus());

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(runMutation).toHaveBeenCalledTimes(2);
    expect(runMutation.mock.calls[1]?.[1]).toMatchObject({
      nowMs: 10,
      dailyLimit: 7_500,
      dailyRemaining: 7_499,
      minuteLimit: 60,
      minuteRemaining: 59,
    });
    expect(controller.latestReceipt()).toMatchObject({
      circuitGeneration: 3,
    });
  });

  it("never calls the provider after a denied admission", async () => {
    const runMutation = vi.fn().mockResolvedValue({
      ok: false,
      reason: "protected_reserve",
      retryAtMs: 123,
    });
    const fetch = vi.fn();
    const controller = createReliableApiSportsFetch({
      ctx: { runMutation } as never,
      surface: "schedule",
      traffic: "routine",
      nowMs: () => 10,
    });
    const client = createApiSportsClient({
      apiKey: "test-key",
      fetch,
      requestFence: controller.fence,
      nowMs: () => 10,
    });
    await expect(
      runEffect(client.fetchStatus()),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect(controller.denial()).toEqual({
      reason: "protected_reserve",
      retryAtMs: 123,
    });
  });

  it("does not count a later-page local denial as a provider failure", async () => {
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        receipt: {
          dailyWindowStartedAtMs: 1,
          providerMinuteWindowStartedAtMs: 2,
          circuitGeneration: 3,
          probeToken: null,
        },
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        ok: false,
        reason: "minute_exhausted",
        retryAtMs: 456,
      });
    const fetch = vi.fn().mockResolvedValue(
      statusResponse({ status: 200 }),
    );
    const controller = createReliableApiSportsFetch({
      ctx: { runMutation } as never,
      surface: "schedule",
      traffic: "routine",
      nowMs: () => 10,
    });
    const client = createApiSportsClient({
      apiKey: "test-key",
      fetch,
      requestFence: controller.fence,
      nowMs: () => 10,
    });
    await runEffect(client.fetchStatus());
    await expect(
      runEffect(client.fetchStatus()),
    ).rejects.toThrow();
    await expect(
      controller.recordOutcome({
        success: false,
        attempt: 2,
        nowMs: 20,
      }),
    ).resolves.toEqual({
      retryAtMs: 456,
      recorded: false,
      deferredReason: "minute_exhausted",
    });
    expect(runMutation).toHaveBeenCalledTimes(3);
  });

  it("reconciles 429 headers and returns a durable quota deferral without recording a circuit failure", async () => {
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        receipt: {
          dailyWindowStartedAtMs: 1,
          providerMinuteWindowStartedAtMs: 2,
          circuitGeneration: 3,
          probeToken: null,
        },
      })
      .mockResolvedValueOnce({ quotaRetryAtMs: 999 });
    const controller = createReliableApiSportsFetch({
      ctx: { runMutation } as never,
      surface: "live",
      traffic: "protected",
      nowMs: () => 10,
    });
    const client = createApiSportsClient({
      apiKey: "test-key",
      requestFence: controller.fence,
      fetch: vi.fn().mockResolvedValue(
        new Response("{}", {
          status: 429,
          headers: {
            "x-ratelimit-limit": "10",
            "x-ratelimit-remaining": "0",
          },
        }),
      ),
      nowMs: () => 10,
    });
    await expect(runEffect(client.fetchStatus())).rejects.toThrow();
    await expect(
      controller.recordOutcome({
        success: false,
        attempt: 4,
        nowMs: 20,
      }),
    ).resolves.toEqual({
      retryAtMs: 999,
      recorded: false,
      deferredReason: "provider_rate_limited",
    });
    expect(runMutation).toHaveBeenCalledTimes(2);
    expect(runMutation.mock.calls[1]?.[1]).toMatchObject({
      minuteLimit: 10,
      minuteRemaining: 0,
    });
  });

  it("does not attribute a quota-reconciliation mutation failure to the provider", async () => {
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        receipt: {
          dailyWindowStartedAtMs: 1,
          providerMinuteWindowStartedAtMs: 2,
          circuitGeneration: 3,
          probeToken: null,
        },
      })
      .mockRejectedValueOnce(new Error("local Convex failure"));
    const fetch = vi.fn().mockResolvedValue(
      statusResponse({ status: 200 }),
    );
    const controller = createReliableApiSportsFetch({
      ctx: { runMutation } as never,
      surface: "live",
      traffic: "protected",
      nowMs: () => 10,
    });
    const client = createApiSportsClient({
      apiKey: "test-key",
      requestFence: controller.fence,
      fetch,
      nowMs: () => 10,
    });

    await expect(runEffect(client.fetchStatus())).rejects.toThrow();
    await expect(
      controller.recordOutcome({
        success: false,
        attempt: 3,
        nowMs: 20,
      }),
    ).resolves.toEqual({
      retryAtMs: 60_020,
      recorded: false,
      deferredReason: "provider_reliability_boundary_failed",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(runMutation).toHaveBeenCalledTimes(2);
  });

  it("still attributes a known provider HTTP failure when quota reconciliation also fails", async () => {
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        receipt: {
          dailyWindowStartedAtMs: 1,
          providerMinuteWindowStartedAtMs: 2,
          circuitGeneration: 3,
          probeToken: null,
        },
      })
      .mockRejectedValueOnce(new Error("local Convex failure"))
      .mockResolvedValueOnce({
        retryAtMs: 1_234,
        circuitStatus: "closed",
      });
    const controller = createReliableApiSportsFetch({
      ctx: { runMutation } as never,
      surface: "live",
      traffic: "protected",
      nowMs: () => 10,
    });
    const client = createApiSportsClient({
      apiKey: "test-key",
      requestFence: controller.fence,
      fetch: vi.fn().mockResolvedValue(
        new Response("{}", { status: 503 }),
      ),
      nowMs: () => 10,
    });

    await expect(runEffect(client.fetchStatus())).rejects.toThrow();
    await expect(
      controller.recordOutcome({
        success: false,
        attempt: 3,
        nowMs: 20,
        failureReason: "live_fetch_failed",
      }),
    ).resolves.toMatchObject({
      retryAtMs: 1_234,
      recorded: true,
    });
    expect(runMutation).toHaveBeenCalledTimes(3);
  });
});

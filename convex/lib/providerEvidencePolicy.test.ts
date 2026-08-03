import { describe, expect, it } from "vitest";

import {
  PROVIDER_DIAGNOSTIC_RETENTION_MS,
  providerDiagnosticExpiry,
  providerDiagnosticFingerprint,
  sanitizeProviderStatus,
  sanitizeRequestMetadata,
  summarizeProviderResponse,
} from "./providerEvidencePolicy";

describe("provider evidence retention policy", () => {
  it("expires repetitive diagnostics at the exact 30-day boundary", () => {
    const observedAtMs = Date.UTC(2026, 0, 1);

    expect(PROVIDER_DIAGNOSTIC_RETENTION_MS).toBe(
      30 * 24 * 60 * 60 * 1_000,
    );
    expect(providerDiagnosticExpiry(observedAtMs)).toBe(
      Date.UTC(2026, 0, 31),
    );
  });

  it("retains only allowlisted request metadata and never provider secrets", () => {
    const metadata = sanitizeRequestMetadata({
      endpoint: "/games",
      parameters: {
        league: 1,
        season: 2026,
        page: 2,
        "x-apisports-key": "provider-secret",
        authorization: "Bearer secret",
        participantEmail: "person@example.com",
      },
    });

    expect(metadata).toEqual({
      endpoint: "/games",
      parameters: {
        league: 1,
        page: 2,
        season: 2026,
      },
    });
    expect(JSON.stringify(metadata)).not.toMatch(
      /provider-secret|bearer|person@example\.com/i,
    );
  });

  it("summarizes raw responses without retaining payloads, secrets, or participant data", async () => {
    const summary = await summarizeProviderResponse(
      JSON.stringify({
        errors: { token: "provider-secret", request: "bad league" },
        paging: { current: 2, total: 4 },
        results: 1,
        response: [
          {
            game: { id: 123 },
            participantEmail: "person@example.com",
          },
        ],
      }),
      "application/json",
    );

    expect(summary).toEqual({
      bodyBytes: expect.any(Number),
      bodyDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      contentType: "json",
      jsonValid: true,
      topLevelKeys: ["errors", "paging", "response", "results"],
      providerErrorCount: 2,
      resultCount: 1,
      pagingCurrent: 2,
      pagingTotal: 4,
    });
    expect(JSON.stringify(summary)).not.toMatch(
      /provider-secret|person@example\.com/i,
    );
  });

  it("uses the exact raw bytes only for a SHA-256 correlation digest", async () => {
    const first = await summarizeProviderResponse(
      '{"results":1,"response":[{"value":"A"}]}',
      "application/json",
    );
    const second = await summarizeProviderResponse(
      '{"results":1,"response":[{"value":"B"}]}',
      "application/json",
    );

    expect(first.bodyBytes).toBe(second.bodyBytes);
    expect(first.resultCount).toBe(second.resultCount);
    expect(first.bodyDigest).not.toBe(second.bodyDigest);
    expect(JSON.stringify([first, second])).not.toMatch(
      /"value"|"A"|"B"/,
    );
  });

  it("keeps bounded status codes while redacting secret, email, and URL canaries", async () => {
    await expect(
      sanitizeProviderStatus({
        short: "Q5",
        long: "Quarter 5",
      }),
    ).resolves.toMatchObject({
      shortPreview: "Q5",
      longPreview: "Quarter 5",
      fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      redacted: false,
    });
    await expect(
      sanitizeProviderStatus({
        short: "MYSTERY",
        long: "New Provider Status",
      }),
    ).resolves.toMatchObject({
      shortPreview: "MYSTERY",
      longPreview: null,
      fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      redacted: true,
    });

    const unsafe = await sanitizeProviderStatus({
      short: "API-KEY provider-secret",
      long:
        "Bearer token person@example.com https://provider.test",
    });
    expect(unsafe).toMatchObject({
      shortPreview: null,
      longPreview: null,
      fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      redacted: true,
    });
    expect(JSON.stringify(unsafe)).not.toMatch(
      /provider-secret|bearer|person@example\.com|provider\.test/i,
    );
  });

  it("fingerprints identical diagnostics deterministically without embedding secrets", async () => {
    const first = await providerDiagnosticFingerprint({
      provider: "api-sports",
      surface: "live",
      scopeKey: "live:nfl",
      incidentId: null,
      gameId: null,
      request: {
        endpoint: "/games",
        parameters: { league: 1, live: "all" },
      },
      outcome: "success",
      httpStatus: 200,
      responseDigest: "1234abcd",
    });
    const second = await providerDiagnosticFingerprint({
      provider: "api-sports",
      surface: "live",
      scopeKey: "live:nfl",
      incidentId: null,
      gameId: null,
      request: {
        endpoint: "/games",
        parameters: { live: "all", league: 1 },
      },
      outcome: "success",
      httpStatus: 200,
      responseDigest: "1234abcd",
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toContain("live:nfl");
  });
});

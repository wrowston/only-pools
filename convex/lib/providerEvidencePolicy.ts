/**
 * Retention and redaction policy for application-owned provider diagnostics.
 *
 * Raw response bodies and request headers never cross this boundary. Only a
 * small structural summary and an irreversible digest are persisted.
 */

export const PROVIDER_DIAGNOSTIC_RETENTION_MS =
  30 * 24 * 60 * 60 * 1_000;

const SAFE_REQUEST_PARAMETERS = new Set([
  "date",
  "id",
  "league",
  "live",
  "page",
  "season",
]);

type RequestParameter = string | number;

export type SanitizedProviderRequest = Readonly<{
  endpoint: string;
  parameters: Readonly<Record<string, RequestParameter>>;
}>;

export type ProviderResponseSummary = Readonly<{
  bodyBytes: number;
  bodyDigest: string;
  contentType: "json" | "text" | "other" | null;
  jsonValid: boolean;
  topLevelKeys: readonly string[];
  providerErrorCount: number;
  resultCount: number | null;
  pagingCurrent: number | null;
  pagingTotal: number | null;
}>;

export type SanitizedProviderStatus = Readonly<{
  shortPreview: string | null;
  longPreview: string | null;
  fingerprint: string;
  redacted: boolean;
}>;

export function providerDiagnosticExpiry(observedAtMs: number): number {
  return observedAtMs + PROVIDER_DIAGNOSTIC_RETENTION_MS;
}

function boundedEndpoint(endpoint: string): string {
  const path = endpoint.trim().split(/[?#]/, 1)[0];
  return path === "/games" || path === "/teams" || path === "/status"
    ? path
    : "/unknown";
}

export function sanitizeRequestMetadata(input: {
  endpoint: string;
  parameters: Readonly<Record<string, RequestParameter>>;
}): SanitizedProviderRequest {
  const parameters: Record<string, RequestParameter> = {};
  for (const key of Object.keys(input.parameters).sort()) {
    if (!SAFE_REQUEST_PARAMETERS.has(key)) continue;
    const value = input.parameters[key];
    if (
      typeof value === "number" ||
      (typeof value === "string" && value.length <= 80)
    ) {
      parameters[key] = value;
    }
  }
  return {
    endpoint: boundedEndpoint(input.endpoint),
    parameters,
  };
}

export async function sha256Fingerprint(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const SAFE_STATUS_LONG_TOKENS = new Set([
  "after",
  "break",
  "cancelled",
  "canceled",
  "delay",
  "delayed",
  "ended",
  "fifth",
  "finished",
  "first",
  "fourth",
  "half",
  "halftime",
  "in",
  "interrupted",
  "not",
  "overtime",
  "period",
  "postponed",
  "progress",
  "quarter",
  "scheduled",
  "second",
  "started",
  "suspended",
  "third",
  "time",
  "unknown",
]);

function safeStatusShort(value: string): string | null {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 12 ||
    !/^[A-Z0-9._/+ -]+$/.test(normalized) ||
    /bearer|token|secret|api[-_ ]?key|authorization|credential|password|https?:|www\.|@/i.test(
      normalized,
    )
  ) {
    return null;
  }
  return normalized;
}

function safeStatusLong(value: string): string | null {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 80 ||
    !/^[A-Za-z0-9 .()/+-]+$/.test(normalized)
  ) {
    return null;
  }
  const tokens = normalized
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return tokens.every(
    (token) =>
      /^\d+$/.test(token) || SAFE_STATUS_LONG_TOKENS.has(token),
  )
    ? normalized
    : null;
}

export async function sanitizeProviderStatus(input: {
  short: string;
  long: string;
}): Promise<SanitizedProviderStatus> {
  const shortCandidate = safeStatusShort(input.short);
  const longCandidate = safeStatusLong(input.long);
  return {
    shortPreview: shortCandidate,
    longPreview: longCandidate,
    fingerprint: await sha256Fingerprint(
      `${input.short}\u001f${input.long}`,
    ),
    redacted: shortCandidate === null || longCandidate === null,
  };
}

function finiteInteger(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : null;
}

function objectValue(
  value: unknown,
): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function safeContentType(
  value: string | null,
): "json" | "text" | "other" | null {
  if (value === null) return null;
  const normalized = value.toLowerCase();
  if (normalized.includes("json")) return "json";
  if (normalized.startsWith("text/")) return "text";
  return "other";
}

const SAFE_TOP_LEVEL_KEYS = new Set([
  "errors",
  "get",
  "paging",
  "parameters",
  "response",
  "results",
]);

export async function summarizeProviderResponse(
  body: string,
  contentType: string | null,
): Promise<ProviderResponseSummary> {
  const base = {
    bodyBytes: new TextEncoder().encode(body).byteLength,
    contentType: safeContentType(contentType),
  };
  let decoded: unknown;
  try {
    decoded = JSON.parse(body) as unknown;
  } catch {
    return {
      ...base,
      bodyDigest: await sha256Fingerprint(body),
      jsonValid: false,
      topLevelKeys: [],
      providerErrorCount: 0,
      resultCount: null,
      pagingCurrent: null,
      pagingTotal: null,
    };
  }
  const root = objectValue(decoded);
  if (!root) {
    return {
      ...base,
      bodyDigest: await sha256Fingerprint(body),
      jsonValid: true,
      topLevelKeys: [],
      providerErrorCount: 0,
      resultCount: null,
      pagingCurrent: null,
      pagingTotal: null,
    };
  }
  const errors = root.errors;
  const errorObject = objectValue(errors);
  const providerErrorCount = Array.isArray(errors)
    ? Math.min(errors.length, 10_000)
    : errorObject
      ? Math.min(Object.keys(errorObject).length, 10_000)
      : 0;
  const paging = objectValue(root.paging);
  const responseCount = Array.isArray(root.response)
    ? root.response.length
    : null;
  const topLevelKeys = Object.keys(root)
    .filter((key) => SAFE_TOP_LEVEL_KEYS.has(key))
    .sort();
  const resultCount = finiteInteger(root.results) ?? responseCount;
  const pagingCurrent = finiteInteger(paging?.current);
  const pagingTotal = finiteInteger(paging?.total);
  // The exact response bytes are never persisted; only their cryptographic
  // digest is retained for request correlation and change investigation.
  const bodyDigest = await sha256Fingerprint(body);

  return {
    ...base,
    bodyDigest,
    jsonValid: true,
    topLevelKeys,
    providerErrorCount,
    resultCount,
    pagingCurrent,
    pagingTotal,
  };
}

function stableRequestJson(
  request: SanitizedProviderRequest,
): string {
  const parameters: Record<string, RequestParameter> = {};
  for (const key of Object.keys(request.parameters).sort()) {
    parameters[key] = request.parameters[key]!;
  }
  return JSON.stringify({
    endpoint: request.endpoint,
    parameters,
  });
}

export async function providerDiagnosticFingerprint(input: {
  provider: string;
  surface: string;
  scopeKey: string | null;
  incidentId: string | null;
  gameId: string | null;
  request: SanitizedProviderRequest;
  outcome: string;
  httpStatus: number | null;
  responseDigest: string | null;
}): Promise<string> {
  return await sha256Fingerprint(
    [
      input.provider,
      input.surface,
      input.scopeKey ?? "",
      input.incidentId ?? "",
      input.gameId ?? "",
      stableRequestJson(input.request),
      input.outcome,
      input.httpStatus ?? "",
      input.responseDigest ?? "",
    ].join("\u001f"),
  );
}

/**
 * Structured server-side logging for Convex.
 *
 * Emits one JSON object per line to stdout/stderr so entries appear in
 * Convex application logs (Dashboard → Logs). Convex function console
 * output is never sent to browsers — keep this module out of client bundles.
 *
 * Never put Hidden Pick values, invite credentials, API keys, raw provider
 * payloads, or verified contact fields in `fields`. Prefer ids + counts.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogPrimitive = string | number | boolean | null;

export type LogFields = Record<string, LogPrimitive | undefined>;

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** Field names that must never appear in cleartext in application logs. */
const SENSITIVE_FIELD_KEYS = new Set([
  "apikey",
  "authorization",
  "confidence",
  "confidences",
  "credentialhash",
  "credentialsecret",
  "hiddenteamid",
  "inviteurl",
  "invitetoken",
  "password",
  "pick",
  "picks",
  "rawtoken",
  "secret",
  "selectedteamid",
  "survivorteamid",
  "token",
]);

function resolveMinLevel(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): LogLevel {
  const raw = env.LOG_LEVEL?.trim().toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return "info";
}

export function shouldLog(
  level: LogLevel,
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[resolveMinLevel(env)];
}

export function sanitizeLogFields(
  fields?: LogFields,
): Record<string, LogPrimitive> | undefined {
  if (!fields) return undefined;
  const out: Record<string, LogPrimitive> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (SENSITIVE_FIELD_KEYS.has(key.toLowerCase().replace(/[_-]/g, ""))) {
      out[key] = "[redacted]";
      continue;
    }
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Strip TheSportsDB API keys from URLs before logging. */
export function redactProviderUrl(url: string): string {
  return url
    .replace(/\/api\/v1\/json\/[^/?#]+/gi, "/api/v1/json/[redacted]")
    .replace(/([?&](?:api_?key|key)=)[^&]*/gi, "$1[redacted]");
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown_error";
}

export type Logger = {
  debug: (msg: string, fields?: LogFields) => void;
  info: (msg: string, fields?: LogFields) => void;
  warn: (msg: string, fields?: LogFields) => void;
  error: (msg: string, fields?: LogFields) => void;
  child: (fields: LogFields) => Logger;
};

type EmitDeps = {
  env?: Record<string, string | undefined>;
  write?: (level: LogLevel, line: string) => void;
  nowMs?: () => number;
};

function defaultWrite(level: LogLevel, line: string): void {
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  // info + debug — Convex captures console.log in application Logs.
  console.log(line);
}

function emit(
  level: LogLevel,
  scope: string,
  msg: string,
  fields: LogFields | undefined,
  baseFields: LogFields | undefined,
  deps: EmitDeps,
): void {
  const env = deps.env ?? (process.env as Record<string, string | undefined>);
  if (!shouldLog(level, env)) return;

  const nowMs = deps.nowMs?.() ?? Date.now();
  const record: Record<string, LogPrimitive> = {
    level,
    scope,
    msg,
    atMs: nowMs,
    ...(sanitizeLogFields(baseFields) ?? {}),
    ...(sanitizeLogFields(fields) ?? {}),
  };

  const write = deps.write ?? defaultWrite;
  write(level, JSON.stringify(record));
}

/**
 * Create a scoped logger. Prefer one module-level logger per file, e.g.
 * `const log = createLogger("syncLive")`.
 */
export function createLogger(
  scope: string,
  baseFields?: LogFields,
  deps: EmitDeps = {},
): Logger {
  return {
    debug: (msg, fields) => emit("debug", scope, msg, fields, baseFields, deps),
    info: (msg, fields) => emit("info", scope, msg, fields, baseFields, deps),
    warn: (msg, fields) => emit("warn", scope, msg, fields, baseFields, deps),
    error: (msg, fields) => emit("error", scope, msg, fields, baseFields, deps),
    child: (fields) =>
      createLogger(scope, { ...baseFields, ...fields }, deps),
  };
}

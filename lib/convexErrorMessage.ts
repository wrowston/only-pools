import { ConvexError } from "convex/values";

/**
 * Extract a user-facing message from a Convex mutation/query rejection.
 * Prefers `ConvexError.data`; falls back to parsing wrapped server errors.
 * Never returns raw `[CONVEX …]` / stack / request-id wrappers.
 */
export function convexErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ConvexError) {
    const data = err.data;
    if (typeof data === "string" && data.trim() !== "") {
      return data;
    }
    if (
      data !== null &&
      typeof data === "object" &&
      "message" in data &&
      typeof (data as { message: unknown }).message === "string" &&
      (data as { message: string }).message.trim() !== ""
    ) {
      return (data as { message: string }).message;
    }
  }

  if (err instanceof Error) {
    const wrapped = err.message.match(
      /Uncaught (?:[\w.]+Error:\s*)?(.+?)(?:\s+at handler\b|\n|$)/,
    );
    if (wrapped?.[1]?.trim()) {
      return wrapped[1].trim().replace(/\s+Called by client\s*$/i, "");
    }
    if (err.message.trim() !== "" && !err.message.startsWith("[CONVEX")) {
      return err.message;
    }
  }

  return fallback;
}

/**
 * Help intake rate limiting — keyed hashes only, never raw network addresses.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import {
  HELP_THROTTLE_WINDOW_MS,
  RATE_LIMIT_ACCOUNT_PER_WINDOW,
  RATE_LIMIT_NETWORK_PER_WINDOW,
} from "./helpConstants";

const throttleKeyKindValidator = v.union(
  v.literal("account"),
  v.literal("network"),
);

export type ThrottleKeyKind = "account" | "network";

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function hmacSha256Hex(
  secret: string,
  message: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(message),
  );
  return bytesToHex(signature);
}

export async function hashHelpAccountKey(
  secret: string,
  participantId: string,
): Promise<string> {
  return await hmacSha256Hex(secret, `help:account:${participantId}`);
}

export async function hashHelpNetworkKey(
  secret: string,
  networkAddress: string,
): Promise<string> {
  return await hmacSha256Hex(secret, `help:network:${networkAddress}`);
}

/** Best available client network address from proxy headers — never persisted. */
export function extractClientNetworkAddress(
  headers: Headers,
): string | null {
  const cfConnectingIp = headers.get("cf-connecting-ip")?.trim();
  if (cfConnectingIp) return cfConnectingIp;

  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const forwardedFor = headers.get("x-forwarded-for")?.trim();
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }

  return null;
}

function limitForKind(kind: ThrottleKeyKind): number {
  return kind === "account"
    ? RATE_LIMIT_ACCOUNT_PER_WINDOW
    : RATE_LIMIT_NETWORK_PER_WINDOW;
}

async function incrementThrottleKey(
  ctx: { db: import("../_generated/server").MutationCtx["db"] },
  args: {
    keyHash: string;
    keyKind: ThrottleKeyKind;
    nowMs: number;
  },
): Promise<boolean> {
  const limit = limitForKind(args.keyKind);
  const existing = await ctx.db
    .query("helpThrottle")
    .withIndex("by_keyHash", (q) => q.eq("keyHash", args.keyHash))
    .unique();

  if (!existing || existing.expiresAtMs <= args.nowMs) {
    const expiresAtMs = args.nowMs + HELP_THROTTLE_WINDOW_MS;
    if (existing) {
      await ctx.db.patch(existing._id, {
        keyKind: args.keyKind,
        windowStartMs: args.nowMs,
        count: 1,
        expiresAtMs,
      });
    } else {
      await ctx.db.insert("helpThrottle", {
        keyHash: args.keyHash,
        keyKind: args.keyKind,
        windowStartMs: args.nowMs,
        count: 1,
        expiresAtMs,
      });
    }
    return true;
  }

  if (existing.count >= limit) {
    return false;
  }

  await ctx.db.patch(existing._id, {
    count: existing.count + 1,
  });
  return true;
}

export async function checkAndIncrementHelpThrottle(
  ctx: { db: import("../_generated/server").MutationCtx["db"] },
  args: {
    accountKeyHash?: string;
    networkKeyHash?: string;
    nowMs: number;
  },
): Promise<boolean> {
  if (args.accountKeyHash) {
    const ok = await incrementThrottleKey(ctx, {
      keyHash: args.accountKeyHash,
      keyKind: "account",
      nowMs: args.nowMs,
    });
    if (!ok) {
      return false;
    }
  }

  if (args.networkKeyHash) {
    const ok = await incrementThrottleKey(ctx, {
      keyHash: args.networkKeyHash,
      keyKind: "network",
      nowMs: args.nowMs,
    });
    if (!ok) {
      return false;
    }
  }

  return true;
}

export const checkAndIncrementThrottle = internalMutation({
  args: {
    accountKeyHash: v.optional(v.string()),
    networkKeyHash: v.optional(v.string()),
    nowMs: v.number(),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args) => {
    const ok = await checkAndIncrementHelpThrottle(ctx, args);
    return { ok };
  },
});

export const resetHelpThrottleForTests = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const rows = await ctx.db.query("helpThrottle").take(500);
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    return null;
  },
});

export const getHelpThrottleByKeyHash = internalQuery({
  args: { keyHash: v.string() },
  returns: v.union(
    v.object({
      keyHash: v.string(),
      keyKind: throttleKeyKindValidator,
      windowStartMs: v.number(),
      count: v.number(),
      expiresAtMs: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("helpThrottle")
      .withIndex("by_keyHash", (q) => q.eq("keyHash", args.keyHash))
      .unique();
    if (!row) return null;
    return {
      keyHash: row.keyHash,
      keyKind: row.keyKind,
      windowStartMs: row.windowStartMs,
      count: row.count,
      expiresAtMs: row.expiresAtMs,
    };
  },
});

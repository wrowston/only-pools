/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import {
  countActiveSeasonMemberships,
  listActiveMembershipsForParticipant,
  listAllMembershipsForPool,
} from "./membershipQueries";

const modules = import.meta.glob("../**/*.ts");

describe("membershipQueries truncation guards", () => {
  it("counts active season seats past left-history windows", async () => {
    const t = convexTest(schema, modules);
    const { seasonId, participantId } = await t.run(async (ctx) => {
      const seasonId = await ctx.db.insert("poolSeasons", {
        label: "2026",
        year: 2026,
        status: "available",
      });
      const participantId = await ctx.db.insert("participants", {
        tokenIdentifier: "tok|p1",
        clerkUserId: "p1",
        displayName: "P1",
        emailVerified: true,
        phoneVerified: true,
        ageConfirmed: true,
        suspended: false,
      });
      const ownerId = await ctx.db.insert("participants", {
        tokenIdentifier: "tok|owner",
        clerkUserId: "owner",
        displayName: "Owner",
        emailVerified: true,
        phoneVerified: true,
        ageConfirmed: true,
        suspended: false,
      });
      for (let i = 0; i < 70; i++) {
        const poolId = await ctx.db.insert("pools", {
          name: `Left ${i}`,
          type: "survivor",
          seasonId,
          startWeek: 1,
          pickLockMode: "gameKickoff",
          status: "active",
          rulesFrozen: false,
          archived: false,
          ownerParticipantId: ownerId,
          createdAtMs: Date.now(),
        });
        await ctx.db.insert("poolMemberships", {
          poolId,
          participantId,
          role: "member",
          status: "left",
        });
      }
      for (let i = 0; i < 3; i++) {
        const poolId = await ctx.db.insert("pools", {
          name: `Active ${i}`,
          type: "survivor",
          seasonId,
          startWeek: 1,
          pickLockMode: "gameKickoff",
          status: "active",
          rulesFrozen: false,
          archived: false,
          ownerParticipantId: ownerId,
          createdAtMs: Date.now(),
        });
        await ctx.db.insert("poolMemberships", {
          poolId,
          participantId,
          role: "member",
          status: "active",
        });
      }
      return { seasonId, participantId };
    });

    const count = await t.run(async (ctx) =>
      countActiveSeasonMemberships(ctx, participantId, seasonId),
    );
    expect(count).toBe(3);

    const active = await t.run(async (ctx) =>
      listActiveMembershipsForParticipant(ctx, participantId),
    );
    expect(active).toHaveLength(3);
  });

  it("lists every pool membership status past MAX_POOL_ENTRIES churn", async () => {
    const t = convexTest(schema, modules);
    const { poolId } = await t.run(async (ctx) => {
      const seasonId = await ctx.db.insert("poolSeasons", {
        label: "2026",
        year: 2026,
        status: "available",
      });
      const ownerId = await ctx.db.insert("participants", {
        tokenIdentifier: "tok|owner2",
        clerkUserId: "owner2",
        displayName: "Owner",
        emailVerified: true,
        phoneVerified: true,
        ageConfirmed: true,
        suspended: false,
      });
      const poolId = await ctx.db.insert("pools", {
        name: "Busy Pool",
        type: "survivor",
        seasonId,
        startWeek: 1,
        pickLockMode: "gameKickoff",
        status: "active",
        rulesFrozen: false,
        archived: false,
        ownerParticipantId: ownerId,
        createdAtMs: Date.now(),
      });
      await ctx.db.insert("poolMemberships", {
        poolId,
        participantId: ownerId,
        role: "owner",
        status: "active",
      });
      // Simulate admission churn beyond a single take(MAX_POOL_ENTRIES) page.
      for (let i = 0; i < 250; i++) {
        const person = await ctx.db.insert("participants", {
          tokenIdentifier: `tok|churn_${i}`,
          clerkUserId: `churn_${i}`,
          displayName: `Churn ${i}`,
          emailVerified: true,
          phoneVerified: true,
          ageConfirmed: true,
          suspended: false,
        });
        await ctx.db.insert("poolMemberships", {
          poolId,
          participantId: person,
          role: "member",
          status: "left",
        });
      }
      return { poolId };
    });

    const rows = await t.run(async (ctx) =>
      listAllMembershipsForPool(ctx, poolId),
    );
    expect(rows).toHaveLength(251);
    expect(rows.filter((r) => r.status === "active")).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Acceptance scenario 41 — no buy-in / prize / payout / wager fields or workflows.
 */
describe("no money surface (acceptance scenario 41)", () => {
  it("schema and public Convex API modules have no money-surface fields", () => {
    const root = join(import.meta.dirname, "..");
    const schema = readFileSync(join(root, "schema.ts"), "utf8");
    const money =
      /\b(buy[-_]?in|buyIn|entryFee|prize|payout|wager|wallet|stripe)\b/i;

    expect(schema).not.toMatch(money);

    for (const file of [
      "pools.ts",
      "invites.ts",
      "membershipAdmin.ts",
      "participants.ts",
    ]) {
      const src = readFileSync(join(root, file), "utf8");
      expect(src, file).not.toMatch(money);
    }
  });
});

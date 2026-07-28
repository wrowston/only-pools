import { describe, expect, it } from "vitest";
import {
  classifyAliasOwnership,
  providerAliasKey,
} from "./aliases";

describe("generic sports-data aliases", () => {
  it("keys an alias by provider and external identifier", () => {
    expect(
      providerAliasKey({
        provider: "api-sports",
        externalId: "  1042 ",
      }),
    ).toBe("api-sports:1042");
  });

  it("distinguishes a duplicate alias row from ambiguous ownership", () => {
    expect(
      classifyAliasOwnership([
        { ownerId: "game-1" },
        { ownerId: "game-1" },
      ]),
    ).toEqual({
      kind: "duplicate",
      ownerId: "game-1",
      rowCount: 2,
    });

    expect(
      classifyAliasOwnership([
        { ownerId: "game-1" },
        { ownerId: "game-2" },
      ]),
    ).toEqual({
      kind: "ambiguous",
      ownerIds: ["game-1", "game-2"],
    });
  });

  it("reports unclaimed and uniquely owned aliases", () => {
    expect(classifyAliasOwnership([])).toEqual({ kind: "unclaimed" });
    expect(classifyAliasOwnership([{ ownerId: "team-1" }])).toEqual({
      kind: "owned",
      ownerId: "team-1",
    });
  });
});

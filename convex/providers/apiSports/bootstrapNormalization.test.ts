import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import type { ApiSportsTeamWire } from "../../effect/apiSports/schemas";
import { CANONICAL_NFL_TEAM_LIST } from "../sportsData/catalog";
import { normalizeApiSportsTeams } from "./normalize";

function teamRows(): ApiSportsTeamWire[] {
  return CANONICAL_NFL_TEAM_LIST.map((team, index) => ({
    id: 10_000 + index,
    name: team.name,
    code: team.abbreviation,
    logo: team.logoUrl,
  }));
}

describe("API-Sports bootstrap team normalization", () => {
  it("preserves known incomplete and duplicate candidates for staged validation", async () => {
    const rows = teamRows();
    const incomplete = await Effect.runPromise(
      normalizeApiSportsTeams(rows.slice(0, 31), {
        mode: "bootstrap-candidates",
      }),
    );
    const duplicate = await Effect.runPromise(
      normalizeApiSportsTeams([...rows, rows[0]!], {
        mode: "bootstrap-candidates",
      }),
    );

    expect(incomplete).toHaveLength(31);
    expect(duplicate).toHaveLength(33);
    expect(
      duplicate.filter((team) => team.abbreviation === "ARI"),
    ).toHaveLength(2);
  });

  it("keeps the normal adapter contract strict outside bootstrap staging", async () => {
    await expect(
      Effect.runPromise(normalizeApiSportsTeams(teamRows().slice(0, 31))),
    ).rejects.toThrow(/expected 32 current NFL Teams/);
  });

  it("fails specifically when deterministic provider identity signals conflict", async () => {
    const rows = teamRows();
    rows[0] = {
      ...rows[0]!,
      name: "Arizona Cardinals",
      code: "ATL",
    };

    await expect(
      Effect.runPromise(
        normalizeApiSportsTeams(rows, {
          mode: "bootstrap-candidates",
        }),
      ),
    ).rejects.toThrow(/10000.*conflicting deterministic aliases/i);
  });
});

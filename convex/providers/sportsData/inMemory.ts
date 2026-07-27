import * as Effect from "effect/Effect";

import type {
  SportsDataGame,
  SportsDataProvider,
  SportsDataProviderHealth,
  SportsDataProviderAlias,
  SportsDataTeam,
} from "./types";

export type InMemorySportsDataFixture = Readonly<{
  teams: readonly SportsDataTeam[];
  games: readonly SportsDataGame[];
  liveGameAliases: readonly string[];
  health: SportsDataProviderHealth;
}>;

/**
 * Deterministic no-I/O adapter for contract and workflow tests.
 *
 * The live slate is explicit rather than inferred from lifecycle. This mirrors
 * the provider boundary where absence from a live response is not evidence
 * about an NFL Game's state.
 */
export class InMemorySportsDataProvider
  implements SportsDataProvider<never>
{
  readonly name = "in-memory" as const;

  readonly #teams: readonly SportsDataTeam[];
  readonly #games: readonly SportsDataGame[];
  readonly #liveGameAliases: ReadonlySet<string>;
  readonly #health: SportsDataProviderHealth;

  constructor(fixture: InMemorySportsDataFixture) {
    this.#teams = [...fixture.teams];
    this.#games = [...fixture.games];
    this.#liveGameAliases = new Set(fixture.liveGameAliases);
    this.#health = fixture.health;
  }

  listTeams(): Effect.Effect<readonly SportsDataTeam[]> {
    return Effect.succeed(this.#teams);
  }

  listSeasonGames(
    seasonYear: number,
  ): Effect.Effect<readonly SportsDataGame[]> {
    return Effect.succeed(
      this.#games.filter((game) => game.seasonYear === seasonYear),
    );
  }

  listLiveGames(): Effect.Effect<readonly SportsDataGame[]> {
    return Effect.succeed(
      this.#games.filter((game) =>
        game.providerAliases.some(
          (alias) =>
            alias.provider === this.name &&
            this.#liveGameAliases.has(alias.id),
        ),
      ),
    );
  }

  getGame(
    alias: SportsDataProviderAlias,
  ): Effect.Effect<SportsDataGame | null> {
    if (alias.provider !== this.name) return Effect.succeed(null);

    return Effect.succeed(
      this.#games.find((game) =>
        game.providerAliases.some(
          (candidate) =>
            candidate.provider === alias.provider &&
            candidate.id === alias.id,
        ),
      ) ?? null,
    );
  }

  getHealth(): Effect.Effect<SportsDataProviderHealth> {
    return Effect.succeed(this.#health);
  }
}

import * as Effect from "effect/Effect";

import type {
  SportsDataGameObservation,
  SportsDataLiveResult,
  SportsDataProvider,
  SportsDataProviderHealth,
  SportsDataProviderAlias,
  SportsDataSchedulePhase,
  SportsDataTeam,
} from "./types";

export type InMemorySportsDataFixture = Readonly<{
  teams: readonly SportsDataTeam[];
  games: readonly SportsDataGameObservation[];
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
  readonly #games: readonly SportsDataGameObservation[];
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
    phase: SportsDataSchedulePhase = "regular_season",
  ): Effect.Effect<readonly SportsDataGameObservation[]> {
    return Effect.succeed(
      this.#games.filter(
        (game) =>
          game.seasonYear === seasonYear &&
          game.seasonPhase === phase,
      ),
    );
  }

  listLiveGames(): Effect.Effect<readonly SportsDataGameObservation[]> {
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

  listLiveGamesWithFailures(): Effect.Effect<SportsDataLiveResult> {
    return this.listLiveGames().pipe(
      Effect.map((games) => ({ games, failures: [] })),
    );
  }

  getGame(
    alias: SportsDataProviderAlias,
  ): Effect.Effect<SportsDataGameObservation | null> {
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

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  createApiSportsClient,
  type ApiSportsClientError,
  type ApiSportsFetch,
  type ApiSportsRequestFence,
  type ApiSportsQuotaMetadata,
} from "../../effect/apiSports/client";
import { ApiSportsGameSchema } from "../../effect/apiSports/schemas";
import { ApiSportsDecodeError } from "../../effect/errors";
import type {
  SportsDataProvider,
  SportsDataProviderAlias,
  SportsDataProviderHealth,
  SportsDataQuota,
  SportsDataTeam,
} from "../sportsData/types";
import {
  normalizeApiSportsGame,
  normalizeApiSportsGames,
  normalizeApiSportsTeams,
  type ApiSportsGame,
} from "./normalize";

function nextUtcMidnight(nowMs: number): number {
  const now = new Date(nowMs);
  return Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
}

function subtractOrNull(
  limit: number | null,
  remaining: number | null,
): number | null {
  return limit === null || remaining === null
    ? null
    : Math.max(0, limit - remaining);
}

function sportsDataQuota(
  quota: ApiSportsQuotaMetadata,
  observedAtMs: number,
  dailyUsed?: number,
  dailyLimit?: number,
): SportsDataQuota {
  const resolvedDailyLimit = quota.dailyLimit ?? dailyLimit ?? null;
  const requestsUsed =
    dailyUsed ??
    subtractOrNull(resolvedDailyLimit, quota.dailyRemaining) ??
    0;

  return {
    dailyLimit: resolvedDailyLimit,
    requestsUsed,
    requestsRemaining: quota.dailyRemaining,
    minuteLimit: quota.minuteLimit,
    requestsUsedThisMinute: subtractOrNull(
      quota.minuteLimit,
      quota.minuteRemaining,
    ),
    requestsRemainingThisMinute: quota.minuteRemaining,
    resetsAtMs: nextUtcMidnight(observedAtMs),
  };
}

/**
 * Production API-Sports implementation of the provider-neutral seam.
 *
 * Methods return lazy typed Effects. Action/script/HTTP callers own execution.
 */
export class ApiSportsProvider
  implements
    SportsDataProvider<ApiSportsClientError | ApiSportsDecodeError>
{
  readonly name = "api-sports" as const;

  readonly #client: ReturnType<typeof createApiSportsClient>;
  readonly #bootstrapTeamCandidates: boolean;

  constructor(input: {
    apiKey: string;
    fetch?: ApiSportsFetch;
    requestFence?: ApiSportsRequestFence;
    nowMs?: () => number;
    teamSeasonYear?: number;
    bootstrapTeamCandidates?: boolean;
  }) {
    this.#client = createApiSportsClient(input);
    this.#bootstrapTeamCandidates =
      input.bootstrapTeamCandidates ?? false;
  }

  listTeams(): Effect.Effect<
    readonly SportsDataTeam[],
    ApiSportsClientError | ApiSportsDecodeError
  > {
    return this.#client.fetchTeams().pipe(
      Effect.flatMap((response) =>
        normalizeApiSportsTeams(response.data, {
          mode: this.#bootstrapTeamCandidates
            ? "bootstrap-candidates"
            : "strict",
        }),
      ),
    );
  }

  listSeasonGames(
    seasonYear: number,
  ): Effect.Effect<
    readonly ApiSportsGame[],
    ApiSportsClientError | ApiSportsDecodeError
  > {
    return this.#client.fetchSeasonGames(seasonYear).pipe(
      Effect.flatMap((response) =>
        normalizeApiSportsGames(
          response.data.filter(
            (row) =>
              row.game.stage.trim().toLowerCase() ===
              "regular season",
          ),
          response.observedAtMs,
        ),
      ),
      Effect.map((games) =>
        games.filter((game) => game.seasonYear === seasonYear),
      ),
    );
  }

  listLiveGames(): Effect.Effect<
    readonly ApiSportsGame[],
    ApiSportsClientError | ApiSportsDecodeError
  > {
    return this.listLiveGamesWithFailures().pipe(
      Effect.map((result) => result.games),
    );
  }

  listLiveGamesWithFailures(): Effect.Effect<
    Readonly<{
      games: readonly ApiSportsGame[];
      failures: readonly Readonly<{
        rowIndex: number;
        detail: string;
      }>[];
    }>,
    ApiSportsClientError
  > {
    return this.#client.fetchLiveGameCandidates().pipe(
      Effect.flatMap((response) =>
        Effect.all(
          response.data.map((candidate, rowIndex) =>
            Schema.decodeUnknown(ApiSportsGameSchema)(candidate).pipe(
              Effect.mapError(
                () =>
                  new ApiSportsDecodeError({
                    endpoint: "/games",
                    detail: `live row ${rowIndex} did not match the expected schema`,
                  }),
              ),
              Effect.flatMap((row) =>
                normalizeApiSportsGame(row, response.observedAtMs),
              ),
              Effect.map(
                (game) =>
                  ({ _tag: "game" as const, game, rowIndex }),
              ),
              Effect.catchAll((error) =>
                Effect.succeed({
                  _tag: "failure" as const,
                  rowIndex,
                  detail: error.detail,
                }),
              ),
            ),
          ),
          { concurrency: "unbounded" },
        ),
      ),
      Effect.map((results) => {
        const games = new Map<string, ApiSportsGame>();
        const failures: Array<{ rowIndex: number; detail: string }> = [];
        for (const result of results) {
          if (result._tag === "failure") {
            failures.push({
              rowIndex: result.rowIndex,
              detail: result.detail,
            });
            continue;
          }
          if (
            result.game.lifecycle !== "in_progress" &&
            result.game.lifecycle !== "interrupted" &&
            result.game.lifecycle !== "terminal" &&
            result.game.lifecycle !== "canceled" &&
            result.game.lifecycle !== "unknown"
          ) {
            continue;
          }
          const externalId = result.game.providerAliases[0]?.id;
          if (externalId) games.set(externalId, result.game);
        }
        return { games: [...games.values()], failures };
      }),
    );
  }

  getGame(
    alias: SportsDataProviderAlias,
  ): Effect.Effect<
    ApiSportsGame | null,
    ApiSportsClientError | ApiSportsDecodeError
  > {
    if (alias.provider !== this.name) return Effect.succeed(null);

    return this.#client.fetchGame(alias.id).pipe(
      Effect.flatMap((response) => {
        const row = response.data[0];
        return row
          ? normalizeApiSportsGame(row, response.observedAtMs)
          : Effect.succeed(null);
      }),
    );
  }

  getHealth(): Effect.Effect<
    SportsDataProviderHealth,
    ApiSportsClientError
  > {
    return this.#client.fetchStatus().pipe(
      Effect.map((response) => ({
        provider: this.name,
        status: "available" as const,
        checkedAtMs: response.observedAtMs,
        lastSuccessfulRequestAtMs: response.observedAtMs,
        quota: sportsDataQuota(
          response.quota,
          response.observedAtMs,
          response.data.requests.current,
          response.data.requests.limit_day,
        ),
      })),
    );
  }
}

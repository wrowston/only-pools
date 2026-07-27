import * as Effect from "effect/Effect";

import {
  createApiSportsClient,
  type ApiSportsClientError,
  type ApiSportsFetch,
  type ApiSportsQuotaMetadata,
} from "../../effect/apiSports/client";
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

  constructor(input: {
    apiKey: string;
    fetch?: ApiSportsFetch;
    nowMs?: () => number;
    teamSeasonYear?: number;
  }) {
    this.#client = createApiSportsClient(input);
  }

  listTeams(): Effect.Effect<
    readonly SportsDataTeam[],
    ApiSportsClientError | ApiSportsDecodeError
  > {
    return this.#client.fetchTeams().pipe(
      Effect.flatMap((response) =>
        normalizeApiSportsTeams(response.data),
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
    return this.#client.fetchLiveGames().pipe(
      Effect.flatMap((response) =>
        normalizeApiSportsGames(response.data, response.observedAtMs),
      ),
      Effect.map((games) =>
        games.filter(
          (game) =>
            game.lifecycle === "in_progress" ||
            game.lifecycle === "interrupted" ||
            game.lifecycle === "unknown",
        ),
      ),
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

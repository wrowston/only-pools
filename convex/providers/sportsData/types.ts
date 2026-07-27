import type * as Effect from "effect/Effect";

import type {
  CanonicalNflTeam,
  CanonicalNflTeamAbbreviation,
} from "./catalog";

/** Production providers and test adapters implementing the same seam. */
export type SportsDataProviderName = "api-sports" | "in-memory";

/** Replaceable external identity; never a competitive stable key. */
export type SportsDataProviderAlias = Readonly<{
  provider: SportsDataProviderName;
  id: string;
}>;

export type SportsDataTeam = CanonicalNflTeam &
  Readonly<{
    providerAliases: readonly SportsDataProviderAlias[];
  }>;

export type NflGameLifecycle =
  | "scheduled"
  | "in_progress"
  | "interrupted"
  | "postponed"
  | "canceled"
  | "terminal"
  | "unknown";

export type NflGameStableKey =
  `nfl-game:${number}:w${number}:franchise-${number}@franchise-${number}`;

/** Provider-neutral NFL Game observation returned through the sports-data seam. */
export type SportsDataGame = Readonly<{
  stableKey: NflGameStableKey;
  seasonYear: number;
  week: number;
  homeTeamAbbreviation: CanonicalNflTeamAbbreviation;
  awayTeamAbbreviation: CanonicalNflTeamAbbreviation;
  scheduledKickoffMs: number;
  lifecycle: NflGameLifecycle;
  homeScore: number | null;
  awayScore: number | null;
  observedAtMs: number;
  providerAliases: readonly SportsDataProviderAlias[];
}>;

export type SportsDataQuota = Readonly<{
  dailyLimit: number | null;
  requestsUsed: number;
  requestsRemaining: number | null;
  minuteLimit: number | null;
  requestsUsedThisMinute: number | null;
  requestsRemainingThisMinute: number | null;
  resetsAtMs: number | null;
}>;

export type SportsDataProviderHealth = Readonly<{
  provider: SportsDataProviderName;
  status: "available" | "degraded" | "unavailable";
  checkedAtMs: number;
  lastSuccessfulRequestAtMs: number | null;
  quota: SportsDataQuota;
}>;

/**
 * The sole provider-facing interface used by Season Bootstrap and sync work.
 * Implementations perform I/O only when called from an action or script edge.
 */
export interface SportsDataProvider<Error = unknown> {
  readonly name: SportsDataProviderName;
  listTeams(): Effect.Effect<readonly SportsDataTeam[], Error>;
  listSeasonGames(
    seasonYear: number,
  ): Effect.Effect<readonly SportsDataGame[], Error>;
  listLiveGames(): Effect.Effect<readonly SportsDataGame[], Error>;
  getGame(
    alias: SportsDataProviderAlias,
  ): Effect.Effect<SportsDataGame | null, Error>;
  getHealth(): Effect.Effect<SportsDataProviderHealth, Error>;
}

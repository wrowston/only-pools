export {
  CANONICAL_NFL_TEAM_ABBREVIATIONS,
  CANONICAL_NFL_TEAM_LIST,
  CANONICAL_NFL_TEAMS,
} from "./catalog";
export type {
  CanonicalNflTeam,
  CanonicalNflTeamAbbreviation,
  NflTeamStableKey,
} from "./catalog";
export {
  createApiSportsProviderFactory,
  SportsDataProviderConfigurationError,
  selectSportsDataProvider,
} from "./config";
export type {
  ApiSportsProviderFactory,
  ProductionSportsDataProviderName,
  SportsDataDeploymentConfig,
  SportsDataProviderConfigurationErrorCode,
} from "./config";
export { nflGameStableKey, nflTeamStableKey } from "./identity";
export {
  InMemorySportsDataProvider,
} from "./inMemory";
export type { InMemorySportsDataFixture } from "./inMemory";
export type {
  NflGameLifecycle,
  NflGameStableKey,
  SportsDataGame,
  SportsDataGameObservation,
  SportsDataLiveFailure,
  SportsDataLiveResult,
  SportsDataProvider,
  SportsDataProviderAlias,
  SportsDataProviderHealth,
  SportsDataProviderName,
  SportsDataQuota,
  SportsDataSeasonPhase,
  SportsDataStatusObservation,
  SportsDataTeam,
} from "./types";

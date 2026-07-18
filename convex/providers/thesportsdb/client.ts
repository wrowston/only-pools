/**
 * TheSportsDB v1 HTTP client. Used only from Convex actions.
 * Clients never call this module.
 * THESPORTSDB_API_KEY should be a paid key in deployed environments; the
 * public key remains a local-development fallback.
 *
 * Implementation lives in convex/effect/sportsdb (Effect + Schema).
 * This module keeps the Promise adapters used by bootstrap / syncLive.
 */

import type { SportsDbEvent, SportsDbTeam } from "./adapter";
import {
  fetchEventLookupEffect,
  fetchLeagueLivescoreEffect,
  fetchNflTeamsEffect,
  fetchSeasonEventsEffect,
  NFL_LEAGUE_ID,
  sportsDbApiKey,
} from "../../effect/sportsdb/client";
import { runEffect } from "../../effect/run";

export { NFL_LEAGUE_ID, sportsDbApiKey };

/**
 * A paid key returns the complete NFL team set from this list endpoint.
 */
export async function fetchNflTeams(
  apiKey: string = sportsDbApiKey(),
): Promise<SportsDbTeam[]> {
  return [...(await runEffect(fetchNflTeamsEffect(apiKey)))];
}

export async function fetchSeasonEvents(
  seasonLabel: string,
  apiKey: string = sportsDbApiKey(),
): Promise<SportsDbEvent[]> {
  return [...(await runEffect(fetchSeasonEventsEffect(seasonLabel, apiKey)))];
}

/**
 * League-wide livescore (V1 free-tier path). Prefer fixtures in tests —
 * never call from clients. Free tier may return limited/empty live rows.
 */
export async function fetchLeagueLivescore(
  apiKey: string = sportsDbApiKey(),
): Promise<SportsDbEvent[]> {
  return [...(await runEffect(fetchLeagueLivescoreEffect(apiKey)))];
}

/**
 * Targeted event lookup for confirmation / correction. Fixture-only in CI.
 */
export async function fetchEventLookup(
  eventId: string,
  apiKey: string = sportsDbApiKey(),
): Promise<SportsDbEvent | null> {
  return runEffect(fetchEventLookupEffect(eventId, apiKey));
}

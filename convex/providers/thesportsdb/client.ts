/**
 * Free-tier TheSportsDB HTTP client. Used only from Convex actions.
 * Clients never call this module.
 */

import type { SportsDbEvent, SportsDbTeam } from "./adapter";

export const NFL_LEAGUE_ID = "4391";

const FREE_BASE = "https://www.thesportsdb.com/api/v1/json";

export function sportsDbApiKey(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): string {
  return env.THESPORTSDB_API_KEY?.trim() || "123";
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `TheSportsDB request failed: ${response.status} ${response.statusText}`,
    );
  }
  return (await response.json()) as T;
}

/**
 * Free tier: `lookup_all_teams.php?id=4391` can return the wrong league.
 * Prefer `search_all_teams.php?l=NFL`.
 */
export async function fetchNflTeams(
  apiKey: string = sportsDbApiKey(),
): Promise<SportsDbTeam[]> {
  const url = `${FREE_BASE}/${apiKey}/search_all_teams.php?l=NFL`;
  const body = await getJson<{ teams: SportsDbTeam[] | null }>(url);
  return body.teams ?? [];
}

export async function fetchSeasonEvents(
  seasonLabel: string,
  apiKey: string = sportsDbApiKey(),
): Promise<SportsDbEvent[]> {
  const url = `${FREE_BASE}/${apiKey}/eventsseason.php?id=${NFL_LEAGUE_ID}&s=${encodeURIComponent(seasonLabel)}`;
  const body = await getJson<{ events: SportsDbEvent[] | null }>(url);
  return body.events ?? [];
}

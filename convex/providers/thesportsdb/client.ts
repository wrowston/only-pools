/**
 * TheSportsDB v1 HTTP client. Used only from Convex actions.
 * Clients never call this module.
 * THESPORTSDB_API_KEY should be a paid key in deployed environments; the
 * public key remains a local-development fallback.
 */

import type { SportsDbEvent, SportsDbTeam } from "./adapter";

export const NFL_LEAGUE_ID = "4391";

const V1_BASE = "https://www.thesportsdb.com/api/v1/json";

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
 * A paid key returns the complete NFL team set from this list endpoint.
 */
export async function fetchNflTeams(
  apiKey: string = sportsDbApiKey(),
): Promise<SportsDbTeam[]> {
  const url = `${V1_BASE}/${apiKey}/search_all_teams.php?l=NFL`;
  const body = await getJson<{ teams: SportsDbTeam[] | null }>(url);
  return body.teams ?? [];
}

export async function fetchSeasonEvents(
  seasonLabel: string,
  apiKey: string = sportsDbApiKey(),
): Promise<SportsDbEvent[]> {
  const url = `${V1_BASE}/${apiKey}/eventsseason.php?id=${NFL_LEAGUE_ID}&s=${encodeURIComponent(seasonLabel)}`;
  const body = await getJson<{ events: SportsDbEvent[] | null }>(url);
  return body.events ?? [];
}

/**
 * League-wide livescore (V1 free-tier path). Prefer fixtures in tests —
 * never call from clients. Free tier may return limited/empty live rows.
 */
export async function fetchLeagueLivescore(
  apiKey: string = sportsDbApiKey(),
): Promise<SportsDbEvent[]> {
  const url = `${V1_BASE}/${apiKey}/livescore.php?l=${NFL_LEAGUE_ID}`;
  const body = await getJson<{ events?: SportsDbEvent[] | null; livescore?: SportsDbEvent[] | null }>(
    url,
  );
  return body.events ?? body.livescore ?? [];
}

/**
 * Targeted event lookup for confirmation / correction. Fixture-only in CI.
 */
export async function fetchEventLookup(
  eventId: string,
  apiKey: string = sportsDbApiKey(),
): Promise<SportsDbEvent | null> {
  const url = `${V1_BASE}/${apiKey}/lookupevent.php?id=${encodeURIComponent(eventId)}`;
  const body = await getJson<{ events: SportsDbEvent[] | null }>(url);
  return body.events?.[0] ?? null;
}

/**
 * TheSportsDB → provider-independent NFL Team / NFL Game adapter.
 * Pure functions only. Raw provider shapes never leave this module boundary.
 */

export type SportsDbTeam = {
  idTeam: string;
  strTeam: string;
  strTeamShort?: string | null;
  strTeamAlternate?: string | null;
  strBadge?: string | null;
  idLeague?: string | null;
  strLeague?: string | null;
  strSport?: string | null;
};

export type SportsDbEvent = {
  idEvent: string;
  strEvent?: string | null;
  strSeason?: string | null;
  idLeague?: string | null;
  strHomeTeam?: string | null;
  strAwayTeam?: string | null;
  idHomeTeam: string;
  idAwayTeam: string;
  intRound?: string | number | null;
  intHomeScore?: string | number | null;
  intAwayScore?: string | number | null;
  strTimestamp?: string | null;
  dateEvent?: string | null;
  strTime?: string | null;
  strStatus?: string | null;
  strPostponed?: string | null;
};

export type NflGameLifecycle =
  | "scheduled"
  | "in_progress"
  | "interrupted"
  | "postponed"
  | "canceled"
  | "terminal"
  | "unknown";

export type NormalizedNflTeam = {
  /** Stable competitive identity key (not a Convex document id). */
  stableKey: string;
  name: string;
  abbreviation: string;
  /** Provider-independent team mark URL. TheSportsDB supplies this as strBadge. */
  logoUrl?: string;
  aliases: { sportsDbTeamId: string };
};

export type NormalizedNflGame = {
  /** Stable competitive identity key (not a Convex document id). */
  stableKey: string;
  seasonLabel: string;
  week: number;
  homeTeamStableKey: string;
  awayTeamStableKey: string;
  scheduledKickoffMs: number;
  lifecycle: NflGameLifecycle;
  homeScore: number | null;
  awayScore: number | null;
  aliases: { sportsDbEventId: string };
};

/** Preseason rounds on TheSportsDB NFL feeds use intRound >= 500. */
const PRESEASON_ROUND_MIN = 500;
const REGULAR_SEASON_WEEK_MAX = 18;

export function teamStableKey(sportsDbTeamId: string): string {
  return `nfl-team:${sportsDbTeamId}`;
}

export function gameStableKey(
  seasonLabel: string,
  sportsDbEventId: string,
): string {
  return `nfl-game:${seasonLabel}:${sportsDbEventId}`;
}

export function mapProviderStatusToLifecycle(
  status: string | null | undefined,
): NflGameLifecycle {
  if (status === null || status === undefined || status === "") {
    return "unknown";
  }
  switch (status.toUpperCase()) {
    case "NS":
      return "scheduled";
    case "Q1":
    case "Q2":
    case "Q3":
    case "Q4":
    case "HT":
    case "OT":
      return "in_progress";
    case "FT":
    case "AOT":
      return "terminal";
    case "CANC":
      return "canceled";
    case "PST":
      return "postponed";
    default:
      return "unknown";
  }
}

function parseOptionalScore(
  value: string | number | null | undefined,
): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function parseRound(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse SportsDB timestamp as UTC. Free-tier values often omit the Z suffix
 * but are UTC wall times.
 */
export function parseSportsDbTimestamp(
  timestamp: string | null | undefined,
): number | null {
  if (!timestamp) return null;
  const normalized =
    /Z$|[+-]\d{2}:?\d{2}$/.test(timestamp) ? timestamp : `${timestamp}Z`;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

export function isRegularSeasonRound(round: number): boolean {
  return round >= 1 && round <= REGULAR_SEASON_WEEK_MAX;
}

export function normalizeTeams(rawTeams: SportsDbTeam[]): NormalizedNflTeam[] {
  return rawTeams.map((team) => {
    const logoUrl = (team.strBadge ?? "").trim();
    return {
      stableKey: teamStableKey(team.idTeam),
      name: team.strTeam,
      abbreviation:
        (team.strTeamShort ?? "").trim() ||
        team.strTeam.slice(0, 3).toUpperCase(),
      ...(logoUrl ? { logoUrl } : {}),
      aliases: { sportsDbTeamId: team.idTeam },
    };
  });
}

export function normalizeSeasonEvents(
  rawEvents: SportsDbEvent[],
  seasonLabel: string,
): NormalizedNflGame[] {
  const games: NormalizedNflGame[] = [];

  for (const event of rawEvents) {
    const round = parseRound(event.intRound);
    if (round === null) continue;
    if (round >= PRESEASON_ROUND_MIN) continue;
    if (!isRegularSeasonRound(round)) continue;

    const kickoffMs = parseSportsDbTimestamp(event.strTimestamp);
    if (kickoffMs === null) continue;

    games.push({
      stableKey: gameStableKey(seasonLabel, event.idEvent),
      seasonLabel,
      week: round,
      homeTeamStableKey: teamStableKey(event.idHomeTeam),
      awayTeamStableKey: teamStableKey(event.idAwayTeam),
      scheduledKickoffMs: kickoffMs,
      lifecycle: mapProviderStatusToLifecycle(event.strStatus),
      homeScore: parseOptionalScore(event.intHomeScore),
      awayScore: parseOptionalScore(event.intAwayScore),
      aliases: { sportsDbEventId: event.idEvent },
    });
  }

  return games;
}

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const convexExecutable = path.join(
  process.cwd(),
  "node_modules",
  ".bin",
  "convex",
);

async function runConvexCli<T>(args: string[]): Promise<T> {
  const { stdout } = await execFileAsync(convexExecutable, ["run", ...args], {
    cwd: process.cwd(),
    env: process.env,
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
  });

  return JSON.parse(stdout) as T;
}

export async function runConvexFunction<T>(
  functionName: string,
  args: Record<string, unknown>,
): Promise<T> {
  return await runConvexCli<T>([functionName, JSON.stringify(args)]);
}

export async function runConvexInlineQuery<T>(source: string): Promise<T> {
  return await runConvexCli<T>(["--inline-query", source]);
}

export type TestGame = {
  gameId: string;
  homeTeamId: string;
  awayTeamId: string;
  apiSportsExternalId: string;
  homeAbbreviation: string;
  awayAbbreviation: string;
};

export async function findPoolGameForTeam(
  poolId: string,
  teamAbbreviation: string,
): Promise<TestGame> {
  if (!/^[a-z0-9]+$/i.test(poolId)) {
    throw new Error(`Unexpected Pool ID: ${poolId}`);
  }
  if (!/^[A-Z]{2,4}$/.test(teamAbbreviation)) {
    throw new Error(`Unexpected team abbreviation: ${teamAbbreviation}`);
  }

  const result = await runConvexInlineQuery<TestGame | null>(`
    const pool = await ctx.db.get("${poolId}");
    if (!pool) return null;
    const games = await ctx.db
      .query("nflGames")
      .withIndex("by_seasonId_and_week", (q) =>
        q.eq("seasonId", pool.seasonId).eq("week", pool.startWeek)
      )
      .collect();
    for (const game of games) {
      const home = await ctx.db.get(game.homeTeamId);
      const away = await ctx.db.get(game.awayTeamId);
      const providerAlias = await ctx.db
        .query("nflGameAliases")
        .withIndex("by_nflGameId_and_provider_and_isCurrent", (q) =>
          q
            .eq("nflGameId", game._id)
            .eq("provider", "api-sports")
            .eq("isCurrent", true)
        )
        .unique();
      if (
        providerAlias &&
        (
          home?.abbreviation === "${teamAbbreviation}" ||
          away?.abbreviation === "${teamAbbreviation}"
        )
      ) {
        return {
          gameId: game._id,
          homeTeamId: game.homeTeamId,
          awayTeamId: game.awayTeamId,
          apiSportsExternalId: providerAlias.externalId,
          homeAbbreviation: home?.abbreviation ?? "",
          awayAbbreviation: away?.abbreviation ?? "",
        };
      }
    }
    return null;
  `);

  if (result === null) {
    throw new Error(
      `No game found for ${teamAbbreviation} in Pool ${poolId}`,
    );
  }
  return result;
}

export async function lockGame(gameId: string): Promise<void> {
  const observedAtMs = Date.now();
  await runConvexFunction("syncLive:applyScheduleObservation", {
    observation: {
      gameId,
      observedAtMs,
      scheduledKickoffMs: observedAtMs - 1_000,
      lifecycle: "in_progress",
    },
  });
}

export async function verifySelectedTeamWin(
  game: TestGame,
  selectedTeamAbbreviation: string,
): Promise<void> {
  const selectedHome = game.homeAbbreviation === selectedTeamAbbreviation;
  const homeScore = selectedHome ? 24 : 17;
  const awayScore = selectedHome ? 17 : 24;
  const terminalAtMs = Date.now();

  await runConvexFunction("syncApiSportsLive:applyObservation", {
    observation: {
      externalId: game.apiSportsExternalId,
      observedAtMs: terminalAtMs,
      lifecycle: "terminal",
      homeScore,
      awayScore,
      providerStatus: {
        rawShort: "FT",
        rawLong: "Finished",
        recognized: true,
        terminal: true,
      },
    },
  });
}

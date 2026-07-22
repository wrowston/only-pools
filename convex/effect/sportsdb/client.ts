import { Effect, ParseResult, Schema } from "effect";

import { createLogger, errorMessage, redactProviderUrl } from "../../lib/log";
import { SportsDbDecodeError, SportsDbHttpError } from "../errors";
import {
  SportsDbEventsResponseSchema,
  SportsDbEventWire,
  SportsDbLivescoreResponseSchema,
  SportsDbTeamsResponseSchema,
  SportsDbTeamWire,
} from "./schemas";

export const NFL_LEAGUE_ID = "4391";

const V1_BASE = "https://www.thesportsdb.com/api/v1/json";

const log = createLogger("sportsdb");

export function sportsDbApiKey(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): string {
  return env.THESPORTSDB_API_KEY?.trim() || "123";
}

function endpointName(url: string): string {
  const path = url.split("?")[0] ?? url;
  const file = path.split("/").pop();
  return file && file.length > 0 ? file : "unknown";
}

function getJson<A, I>(
  url: string,
  schema: Schema.Schema<A, I>,
): Effect.Effect<A, SportsDbHttpError | SportsDbDecodeError> {
  return Effect.gen(function* () {
    const startedAtMs = Date.now();
    const endpoint = endpointName(url);
    const safeUrl = redactProviderUrl(url);
    log.debug("provider_request_started", {
      endpoint,
      providerUrl: safeUrl,
    });

    const response = yield* Effect.tryPromise({
      try: () => fetch(url),
      catch: (cause) => {
        log.error("provider_request_failed", {
          endpoint,
          providerUrl: safeUrl,
          status: 0,
          error: errorMessage(cause),
          durationMs: Date.now() - startedAtMs,
        });
        return new SportsDbHttpError({
          status: 0,
          statusText:
            cause instanceof Error ? cause.message : String(cause),
          url,
        });
      },
    });

    if (!response.ok) {
      log.error("provider_request_failed", {
        endpoint,
        providerUrl: safeUrl,
        status: response.status,
        statusText: response.statusText,
        durationMs: Date.now() - startedAtMs,
      });
      return yield* new SportsDbHttpError({
        status: response.status,
        statusText: response.statusText,
        url,
      });
    }

    const json = yield* Effect.tryPromise({
      try: () => response.json() as Promise<unknown>,
      catch: (cause) => {
        log.error("provider_decode_failed", {
          endpoint,
          providerUrl: safeUrl,
          error: errorMessage(cause),
          durationMs: Date.now() - startedAtMs,
        });
        return new SportsDbDecodeError({
          url,
          detail: cause instanceof Error ? cause.message : String(cause),
        });
      },
    });

    return yield* Schema.decodeUnknown(schema)(json).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          log.info("provider_request_ok", {
            endpoint,
            providerUrl: safeUrl,
            status: response.status,
            durationMs: Date.now() - startedAtMs,
          });
        }),
      ),
      Effect.mapError((error) => {
        log.error("provider_decode_failed", {
          endpoint,
          providerUrl: safeUrl,
          error: ParseResult.TreeFormatter.formatErrorSync(error),
          durationMs: Date.now() - startedAtMs,
        });
        return new SportsDbDecodeError({
          url,
          detail: ParseResult.TreeFormatter.formatErrorSync(error),
        });
      }),
    );
  });
}

/** Effect program: list NFL teams from TheSportsDB. */
export const fetchNflTeamsEffect = (
  apiKey: string = sportsDbApiKey(),
): Effect.Effect<
  ReadonlyArray<SportsDbTeamWire>,
  SportsDbHttpError | SportsDbDecodeError
> =>
  Effect.gen(function* () {
    const url = `${V1_BASE}/${apiKey}/search_all_teams.php?l=NFL`;
    const body = yield* getJson(url, SportsDbTeamsResponseSchema);
    return body.teams ?? [];
  });

/** Effect program: season schedule events. */
export const fetchSeasonEventsEffect = (
  seasonLabel: string,
  apiKey: string = sportsDbApiKey(),
): Effect.Effect<
  ReadonlyArray<SportsDbEventWire>,
  SportsDbHttpError | SportsDbDecodeError
> =>
  Effect.gen(function* () {
    const url = `${V1_BASE}/${apiKey}/eventsseason.php?id=${NFL_LEAGUE_ID}&s=${encodeURIComponent(seasonLabel)}`;
    const body = yield* getJson(url, SportsDbEventsResponseSchema);
    return body.events ?? [];
  });

/** Effect program: league-wide livescore rows. */
export const fetchLeagueLivescoreEffect = (
  apiKey: string = sportsDbApiKey(),
): Effect.Effect<
  ReadonlyArray<SportsDbEventWire>,
  SportsDbHttpError | SportsDbDecodeError
> =>
  Effect.gen(function* () {
    const url = `${V1_BASE}/${apiKey}/livescore.php?l=${NFL_LEAGUE_ID}`;
    const body = yield* getJson(url, SportsDbLivescoreResponseSchema);
    return body.events ?? body.livescore ?? [];
  });

/** Effect program: single-event lookup (confirmation / correction). */
export const fetchEventLookupEffect = (
  eventId: string,
  apiKey: string = sportsDbApiKey(),
): Effect.Effect<
  SportsDbEventWire | null,
  SportsDbHttpError | SportsDbDecodeError
> =>
  Effect.gen(function* () {
    const url = `${V1_BASE}/${apiKey}/lookupevent.php?id=${encodeURIComponent(eventId)}`;
    const body = yield* getJson(url, SportsDbEventsResponseSchema);
    return body.events?.[0] ?? null;
  });

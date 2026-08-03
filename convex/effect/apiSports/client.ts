import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  ApiSportsDecodeError,
  ApiSportsHttpError,
  ApiSportsRateLimitError,
  ApiSportsTransportError,
  type ApiSportsQuotaMetadata,
} from "../errors";
import {
  ApiSportsGameSchema,
  ApiSportsStatusEnvelopeSchema,
  ApiSportsTeamSchema,
  apiSportsEnvelopeSchema,
  type ApiSportsGameWire,
  type ApiSportsStatusWire,
  type ApiSportsTeamWire,
} from "./schemas";

export const API_SPORTS_BASE_URL =
  "https://v1.american-football.api-sports.io";
export const API_SPORTS_NFL_LEAGUE_ID = 1;

export type { ApiSportsQuotaMetadata } from "../errors";

export type ApiSportsResponse<Data> = Readonly<{
  data: Data;
  observedAtMs: number;
  quota: ApiSportsQuotaMetadata;
}>;

export type ApiSportsFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type ApiSportsRequestMetadata = Readonly<{
  endpoint: string;
  parameters: Readonly<Record<string, string | number>>;
}>;

export type ApiSportsRequestFence = Readonly<{
  beforeRequest: (
    request: ApiSportsRequestMetadata,
  ) => Effect.Effect<unknown, unknown>;
  afterResponse: (
    admission: unknown,
    response: Response,
    request: ApiSportsRequestMetadata,
  ) => Effect.Effect<void, unknown>;
  afterError?: (
    admission: unknown,
    request: ApiSportsRequestMetadata,
  ) => Effect.Effect<void, never>;
  afterOutcome?: (
    admission: unknown,
    response: Response,
    request: ApiSportsRequestMetadata,
    outcome:
      | "success"
      | "http_error"
      | "rate_limited"
      | "malformed",
  ) => Effect.Effect<void, never>;
}>;

export type ApiSportsClientError =
  | ApiSportsTransportError
  | ApiSportsHttpError
  | ApiSportsRateLimitError
  | ApiSportsDecodeError;

function headerInteger(headers: Headers, name: string): number | null {
  const value = headers.get(name);
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function quotaFromHeaders(headers: Headers): ApiSportsQuotaMetadata {
  return {
    dailyLimit: headerInteger(headers, "x-ratelimit-requests-limit"),
    dailyRemaining: headerInteger(
      headers,
      "x-ratelimit-requests-remaining",
    ),
    minuteLimit: headerInteger(headers, "x-ratelimit-limit"),
    minuteRemaining: headerInteger(headers, "x-ratelimit-remaining"),
  };
}

function hasProviderErrors(
  errors: readonly string[] | Readonly<Record<string, string>>,
): boolean {
  return Array.isArray(errors)
    ? errors.length > 0
    : Object.keys(errors).length > 0;
}

function isProviderRateLimitError(
  errors: readonly string[] | Readonly<Record<string, string>>,
): boolean {
  const text = Array.isArray(errors)
    ? errors.join(" ")
    : Object.entries(errors)
        .flatMap(([key, value]) => [key, value])
        .join(" ");
  return /quota|rate.?limit|request.?limit|too many requests/i.test(
    text,
  );
}

function redactApiKey(value: string, apiKey: string): string {
  return apiKey.length > 0 ? value.split(apiKey).join("[redacted]") : value;
}

function endpointUrl(
  endpoint: string,
  parameters: Readonly<Record<string, string | number>>,
): string {
  const url = new URL(endpoint, API_SPORTS_BASE_URL);
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function requestEffect<A, I>(input: {
  endpoint: string;
  parameters: Readonly<Record<string, string | number>>;
  apiKey: string;
  fetch: ApiSportsFetch;
  requestFence?: ApiSportsRequestFence;
  nowMs: () => number;
  schema: Schema.Schema<A, I>;
}): Effect.Effect<ApiSportsResponse<A>, ApiSportsClientError> {
  return Effect.gen(function* () {
    const requestMetadata = {
      endpoint: input.endpoint,
      parameters: input.parameters,
    };
    const admission = input.requestFence
      ? yield* input.requestFence.beforeRequest(requestMetadata).pipe(
          Effect.mapError(
            () =>
              new ApiSportsTransportError({
                endpoint: input.endpoint,
              }),
          ),
        )
      : null;
    const response = yield* Effect.tryPromise({
      try: () =>
        input.fetch(endpointUrl(input.endpoint, input.parameters), {
          method: "GET",
          headers: { "x-apisports-key": input.apiKey },
        }),
      catch: () =>
        new ApiSportsTransportError({ endpoint: input.endpoint }),
    }).pipe(
      Effect.tapError(() =>
        input.requestFence?.afterError
          ? input.requestFence.afterError(
              admission,
              requestMetadata,
            )
          : Effect.void,
      ),
    );
    if (input.requestFence) {
      yield* input.requestFence
        .afterResponse(admission, response, requestMetadata)
        .pipe(
          Effect.mapError(
            () =>
              new ApiSportsTransportError({
                endpoint: input.endpoint,
              }),
          ),
        );
    }
    const recordOutcome = (
      outcome:
        | "success"
        | "http_error"
        | "rate_limited"
        | "malformed",
    ) =>
      input.requestFence?.afterOutcome
        ? input.requestFence.afterOutcome(
            admission,
            response,
            requestMetadata,
            outcome,
          )
        : Effect.void;
    const quota = quotaFromHeaders(response.headers);

    if (response.status === 429) {
      yield* recordOutcome("rate_limited");
      return yield* new ApiSportsRateLimitError({
        endpoint: input.endpoint,
        status: response.status,
        quota,
      });
    }
    if (!response.ok) {
      yield* recordOutcome("http_error");
      return yield* new ApiSportsHttpError({
        endpoint: input.endpoint,
        status: response.status,
        statusText: redactApiKey(response.statusText, input.apiKey),
      });
    }

    const json = yield* Effect.tryPromise({
      try: () => response.json() as Promise<unknown>,
      catch: () =>
        new ApiSportsDecodeError({
          endpoint: input.endpoint,
          detail: "response was not valid JSON",
        }),
    }).pipe(
      Effect.tapError(() => recordOutcome("malformed")),
    );
    const decoded = yield* Schema.decodeUnknown(input.schema)(json).pipe(
      Effect.mapError(
        () =>
          new ApiSportsDecodeError({
            endpoint: input.endpoint,
            detail: "response did not match the expected schema",
          }),
      ),
      Effect.tapError(() => recordOutcome("malformed")),
    );

    if (
      typeof decoded === "object" &&
      decoded !== null &&
      "errors" in decoded
    ) {
      const providerErrors = decoded.errors as
        | readonly string[]
        | Readonly<Record<string, string>>;
      if (!hasProviderErrors(providerErrors)) {
        yield* recordOutcome("success");
        return {
          data: decoded,
          observedAtMs: input.nowMs(),
          quota,
        };
      }
      if (isProviderRateLimitError(providerErrors)) {
        yield* recordOutcome("rate_limited");
        return yield* new ApiSportsRateLimitError({
          endpoint: input.endpoint,
          status: response.status,
          quota,
        });
      }
      yield* recordOutcome("http_error");
      return yield* new ApiSportsHttpError({
        endpoint: input.endpoint,
        status: response.status,
        statusText: "Provider rejected request",
      });
    }

    yield* recordOutcome("success");
    return {
      data: decoded,
      observedAtMs: input.nowMs(),
      quota,
    };
  });
}

function pagedGamesRequestEffect(input: {
  parameters: Readonly<Record<string, string | number>>;
  apiKey: string;
  fetch: ApiSportsFetch;
  requestFence?: ApiSportsRequestFence;
  nowMs: () => number;
}): Effect.Effect<
  ApiSportsResponse<readonly ApiSportsGameWire[]>,
  ApiSportsClientError
> {
  return Effect.gen(function* () {
    let latest = yield* requestEffect({
      endpoint: "/games",
      parameters: input.parameters,
      apiKey: input.apiKey,
      fetch: input.fetch,
      requestFence: input.requestFence,
      nowMs: input.nowMs,
      schema: apiSportsEnvelopeSchema(ApiSportsGameSchema),
    });
    const rows = [...latest.data.response];
    let currentPage = latest.data.paging?.current ?? 1;
    let totalPages = latest.data.paging?.total ?? currentPage;

    while (currentPage < totalPages) {
      const requestedPage = currentPage + 1;
      latest = yield* requestEffect({
        endpoint: "/games",
        parameters: { ...input.parameters, page: requestedPage },
        apiKey: input.apiKey,
        fetch: input.fetch,
        requestFence: input.requestFence,
        nowMs: input.nowMs,
        schema: apiSportsEnvelopeSchema(ApiSportsGameSchema),
      });
      rows.push(...latest.data.response);

      const paging = latest.data.paging;
      if (!paging || paging.current < requestedPage) break;
      currentPage = paging.current;
      totalPages = paging.total;
    }

    return {
      data: rows,
      observedAtMs: latest.observedAtMs,
      quota: latest.quota,
    };
  });
}

export function createApiSportsClient(input: {
  apiKey: string;
  fetch?: ApiSportsFetch;
  nowMs?: () => number;
  teamSeasonYear?: number;
  requestFence?: ApiSportsRequestFence;
}) {
  const fetch = input.fetch ?? globalThis.fetch.bind(globalThis);
  const nowMs = input.nowMs ?? Date.now;

  return {
    fetchTeams: (): Effect.Effect<
      ApiSportsResponse<readonly ApiSportsTeamWire[]>,
      ApiSportsClientError
    > =>
      requestEffect({
        endpoint: "/teams",
        parameters: {
          league: API_SPORTS_NFL_LEAGUE_ID,
          season:
            input.teamSeasonYear ??
            new Date(nowMs()).getUTCFullYear(),
        },
        apiKey: input.apiKey,
        fetch,
        requestFence: input.requestFence,
        nowMs,
        schema: apiSportsEnvelopeSchema(ApiSportsTeamSchema),
      }).pipe(Effect.map((result) => ({ ...result, data: result.data.response }))),
    fetchSeasonGames: (
      seasonYear: number,
    ): Effect.Effect<
      ApiSportsResponse<readonly ApiSportsGameWire[]>,
      ApiSportsClientError
    > =>
      pagedGamesRequestEffect({
        parameters: {
          league: API_SPORTS_NFL_LEAGUE_ID,
          season: seasonYear,
        },
        apiKey: input.apiKey,
        fetch,
        requestFence: input.requestFence,
        nowMs,
      }),
    fetchLiveGames: (): Effect.Effect<
      ApiSportsResponse<readonly ApiSportsGameWire[]>,
      ApiSportsClientError
    > =>
      Effect.gen(function* () {
        const currentDate = new Date(nowMs());
        const priorDate = new Date(
          Date.UTC(
            currentDate.getUTCFullYear(),
            currentDate.getUTCMonth(),
            currentDate.getUTCDate() - 1,
          ),
        );
        const responses = yield* Effect.all(
          [priorDate, currentDate].map((date) =>
            pagedGamesRequestEffect({
              parameters: {
                league: API_SPORTS_NFL_LEAGUE_ID,
                date: date.toISOString().slice(0, 10),
              },
              apiKey: input.apiKey,
              fetch,
              requestFence: input.requestFence,
              nowMs,
            }),
          ),
          { concurrency: 1 },
        );
        const latest = responses.at(-1)!;
        const games = new Map<number, ApiSportsGameWire>();
        for (const response of responses) {
          for (const game of response.data) {
            games.set(game.game.id, game);
          }
        }
        return {
          data: [...games.values()],
          observedAtMs: latest.observedAtMs,
          quota: latest.quota,
        };
      }),
    /**
     * The league-wide live slate is an availability feed. Keep the envelope
     * strict, but leave row decoding to the adapter so one bad row cannot
     * suppress valid sibling observations.
     */
    fetchLiveGameCandidates: (): Effect.Effect<
      ApiSportsResponse<readonly unknown[]>,
      ApiSportsClientError
    > =>
      requestEffect({
        endpoint: "/games",
        parameters: {
          league: API_SPORTS_NFL_LEAGUE_ID,
          live: "all",
        },
        apiKey: input.apiKey,
        fetch,
        requestFence: input.requestFence,
        nowMs,
        schema: apiSportsEnvelopeSchema(Schema.Unknown),
      }).pipe(
        Effect.map((result) => ({
          ...result,
          data: result.data.response,
        })),
      ),
    fetchGame: (
      gameId: string,
    ): Effect.Effect<
      ApiSportsResponse<readonly ApiSportsGameWire[]>,
      ApiSportsClientError
    > =>
      requestEffect({
        endpoint: "/games",
        parameters: { id: gameId },
        apiKey: input.apiKey,
        fetch,
        requestFence: input.requestFence,
        nowMs,
        schema: apiSportsEnvelopeSchema(ApiSportsGameSchema),
      }).pipe(Effect.map((result) => ({ ...result, data: result.data.response }))),
    fetchStatus: (): Effect.Effect<
      ApiSportsResponse<ApiSportsStatusWire>,
      ApiSportsClientError
    > =>
      requestEffect({
        endpoint: "/status",
        parameters: {},
        apiKey: input.apiKey,
        fetch,
        requestFence: input.requestFence,
        nowMs,
        schema: ApiSportsStatusEnvelopeSchema,
      }).pipe(Effect.map((result) => ({ ...result, data: result.data.response }))),
  };
}

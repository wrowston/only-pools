import { Data } from "effect";

export type ApiSportsQuotaMetadata = Readonly<{
  dailyLimit: number | null;
  dailyRemaining: number | null;
  minuteLimit: number | null;
  minuteRemaining: number | null;
}>;

/** Network failure before API-Sports returned an HTTP response. */
export class ApiSportsTransportError extends Data.TaggedError(
  "ApiSportsTransportError",
)<{
  readonly endpoint: string;
}> {
  override get message(): string {
    return `API-Sports transport failed for ${this.endpoint}`;
  }
}

/** Non-OK API-Sports response that is not a quota failure. */
export class ApiSportsHttpError extends Data.TaggedError("ApiSportsHttpError")<{
  readonly endpoint: string;
  readonly status: number;
  readonly statusText: string;
}> {
  override get message(): string {
    return `API-Sports request failed for ${this.endpoint}: ${this.status} ${this.statusText}`;
  }
}

/** API-Sports refused a request because a daily or per-minute limit was hit. */
export class ApiSportsRateLimitError extends Data.TaggedError(
  "ApiSportsRateLimitError",
)<{
  readonly endpoint: string;
  readonly status: number;
  readonly quota: ApiSportsQuotaMetadata;
}> {
  override get message(): string {
    return `API-Sports rate limit reached for ${this.endpoint}`;
  }
}

/** JSON parse, wire-schema, or normalization failure for API-Sports. */
export class ApiSportsDecodeError extends Data.TaggedError(
  "ApiSportsDecodeError",
)<{
  readonly endpoint: string;
  readonly detail: string;
}> {
  override get message(): string {
    return `API-Sports response decode failed for ${this.endpoint}: ${this.detail}`;
  }
}

/** Non-OK HTTP response or transport failure talking to TheSportsDB. */
export class SportsDbHttpError extends Data.TaggedError("SportsDbHttpError")<{
  readonly status: number;
  readonly statusText: string;
  readonly url: string;
}> {
  override get message(): string {
    return `TheSportsDB request failed: ${this.status} ${this.statusText}`;
  }
}

/** JSON parse or Schema decode failure for a TheSportsDB response body. */
export class SportsDbDecodeError extends Data.TaggedError("SportsDbDecodeError")<{
  readonly url: string;
  readonly detail: string;
}> {
  override get message(): string {
    return `TheSportsDB response decode failed: ${this.detail}`;
  }
}

import { Data } from "effect";

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

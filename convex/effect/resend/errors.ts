import { Data } from "effect";

export class ResendHttpError extends Data.TaggedError("ResendHttpError")<{
  readonly status: number;
  readonly statusText: string;
  readonly detail?: string;
}> {
  override get message(): string {
    return `Resend request failed: ${this.status} ${this.statusText}`;
  }
}

export class ResendDecodeError extends Data.TaggedError("ResendDecodeError")<{
  readonly detail: string;
}> {
  override get message(): string {
    return `Resend response decode failed: ${this.detail}`;
  }
}

export class ResendConfigError extends Data.TaggedError("ResendConfigError")<{
  readonly detail: string;
}> {
  override get message(): string {
    return `Resend configuration error: ${this.detail}`;
  }
}

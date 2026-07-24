import { Schema } from "effect";

export const ResendSendResponseSchema = Schema.Struct({
  id: Schema.String,
});

export type ResendSendResponse = typeof ResendSendResponseSchema.Type;

export const ResendSendRequestSchema = Schema.Struct({
  from: Schema.String,
  to: Schema.Union(Schema.String, Schema.Array(Schema.String)),
  subject: Schema.String,
  text: Schema.optional(Schema.String),
  html: Schema.optional(Schema.String),
  reply_to: Schema.optional(
    Schema.Union(Schema.String, Schema.Array(Schema.String)),
  ),
});

export type ResendSendRequest = typeof ResendSendRequestSchema.Type;

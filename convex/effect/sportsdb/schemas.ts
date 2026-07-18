import { Schema } from "effect";

/**
 * Wire-shape schemas for TheSportsDB v1 JSON.
 * Normalized domain types remain in providers/thesportsdb/adapter.ts.
 */

const NullableString = Schema.NullOr(Schema.String);
const NullableStringOrNumber = Schema.NullOr(
  Schema.Union(Schema.String, Schema.Number),
);

export const SportsDbTeamSchema = Schema.Struct({
  idTeam: Schema.String,
  strTeam: Schema.String,
  strTeamShort: Schema.optional(NullableString),
  strTeamAlternate: Schema.optional(NullableString),
  strBadge: Schema.optional(NullableString),
  idLeague: Schema.optional(NullableString),
  strLeague: Schema.optional(NullableString),
  strSport: Schema.optional(NullableString),
});

export const SportsDbEventSchema = Schema.Struct({
  idEvent: Schema.String,
  strEvent: Schema.optional(NullableString),
  strSeason: Schema.optional(NullableString),
  idLeague: Schema.optional(NullableString),
  strHomeTeam: Schema.optional(NullableString),
  strAwayTeam: Schema.optional(NullableString),
  idHomeTeam: Schema.String,
  idAwayTeam: Schema.String,
  intRound: Schema.optional(NullableStringOrNumber),
  intHomeScore: Schema.optional(NullableStringOrNumber),
  intAwayScore: Schema.optional(NullableStringOrNumber),
  strTimestamp: Schema.optional(NullableString),
  dateEvent: Schema.optional(NullableString),
  strTime: Schema.optional(NullableString),
  strStatus: Schema.optional(NullableString),
  strPostponed: Schema.optional(NullableString),
});

export const SportsDbTeamsResponseSchema = Schema.Struct({
  teams: Schema.NullOr(Schema.Array(SportsDbTeamSchema)),
});

export const SportsDbEventsResponseSchema = Schema.Struct({
  events: Schema.NullOr(Schema.Array(SportsDbEventSchema)),
});

export const SportsDbLivescoreResponseSchema = Schema.Struct({
  events: Schema.optional(Schema.NullOr(Schema.Array(SportsDbEventSchema))),
  livescore: Schema.optional(Schema.NullOr(Schema.Array(SportsDbEventSchema))),
});

export type SportsDbTeamWire = Schema.Schema.Type<typeof SportsDbTeamSchema>;
export type SportsDbEventWire = Schema.Schema.Type<typeof SportsDbEventSchema>;

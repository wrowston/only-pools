import * as Schema from "effect/Schema";

const NullableString = Schema.NullOr(Schema.String);
const NullableNumber = Schema.NullOr(Schema.Number);
const StringOrNumber = Schema.Union(Schema.String, Schema.Number);

export const ApiSportsTeamSchema = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  code: Schema.optional(NullableString),
  logo: Schema.optional(NullableString),
});

export const ApiSportsGameSchema = Schema.Struct({
  game: Schema.Struct({
    id: Schema.Number,
    stage: Schema.String,
    week: Schema.String,
    date: Schema.Struct({
      timestamp: Schema.Number,
    }),
    status: Schema.Struct({
      short: Schema.String,
      long: Schema.String,
    }),
  }),
  league: Schema.Struct({
    id: Schema.Number,
    season: StringOrNumber,
  }),
  teams: Schema.Struct({
    home: Schema.Struct({
      id: Schema.Number,
      name: NullableString,
    }),
    away: Schema.Struct({
      id: Schema.Number,
      name: NullableString,
    }),
  }),
  scores: Schema.Struct({
    home: Schema.Struct({
      total: NullableNumber,
    }),
    away: Schema.Struct({
      total: NullableNumber,
    }),
  }),
});

export const ApiSportsStatusSchema = Schema.Struct({
  requests: Schema.Struct({
    current: Schema.Number,
    limit_day: Schema.Number,
  }),
});

const ApiSportsErrorsSchema = Schema.Union(
  Schema.Array(Schema.String),
  Schema.Record({ key: Schema.String, value: Schema.String }),
);

export function apiSportsEnvelopeSchema<Item, Encoded>(
  item: Schema.Schema<Item, Encoded>,
) {
  return Schema.Struct({
    errors: ApiSportsErrorsSchema,
    paging: Schema.optional(
      Schema.Struct({
        current: Schema.Number,
        total: Schema.Number,
      }),
    ),
    response: Schema.Array(item),
  });
}

export const ApiSportsStatusEnvelopeSchema = Schema.Struct({
  errors: ApiSportsErrorsSchema,
  response: ApiSportsStatusSchema,
});

export type ApiSportsTeamWire = Schema.Schema.Type<
  typeof ApiSportsTeamSchema
>;
export type ApiSportsGameWire = Schema.Schema.Type<
  typeof ApiSportsGameSchema
>;
export type ApiSportsStatusWire = Schema.Schema.Type<
  typeof ApiSportsStatusSchema
>;

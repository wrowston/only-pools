import type { SportsDataProviderName } from "./types";

export type SportsDataAliasProviderName = SportsDataProviderName;

export type ProviderAlias = Readonly<{
  provider: SportsDataAliasProviderName;
  externalId: string;
}>;

export type AliasOwnership<OwnerId extends string> =
  | Readonly<{ kind: "unclaimed" }>
  | Readonly<{ kind: "owned"; ownerId: OwnerId }>
  | Readonly<{
      kind: "duplicate";
      ownerId: OwnerId;
      rowCount: number;
    }>
  | Readonly<{
      kind: "ambiguous";
      ownerIds: readonly OwnerId[];
    }>;

export function normalizeProviderAlias(alias: ProviderAlias): ProviderAlias {
  const externalId = alias.externalId.trim();
  if (externalId.length === 0) {
    throw new RangeError(
      "Sports-data aliases require a provider and external identifier",
    );
  }
  return { provider: alias.provider, externalId };
}

export function providerAliasKey(alias: ProviderAlias): string {
  const normalized = normalizeProviderAlias(alias);
  return `${normalized.provider}:${normalized.externalId}`;
}

export function classifyAliasOwnership<OwnerId extends string>(
  rows: readonly Readonly<{ ownerId: OwnerId }>[],
): AliasOwnership<OwnerId> {
  if (rows.length === 0) return { kind: "unclaimed" };

  const ownerIds = [...new Set(rows.map((row) => row.ownerId))];
  if (ownerIds.length > 1) {
    return { kind: "ambiguous", ownerIds };
  }

  const ownerId = ownerIds[0]!;
  if (rows.length > 1) {
    return { kind: "duplicate", ownerId, rowCount: rows.length };
  }
  return { kind: "owned", ownerId };
}

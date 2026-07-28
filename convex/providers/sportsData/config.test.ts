import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import { InMemorySportsDataProvider } from "./inMemory";
import { SPORTS_DATA_CONTRACT_FIXTURE } from "./testing/contract";
import {
  createApiSportsProviderFactory,
  SportsDataProviderConfigurationError,
  selectSportsDataProvider,
} from "./config";
import type { SportsDataProvider } from "./types";

const adapter = new InMemorySportsDataProvider(SPORTS_DATA_CONTRACT_FIXTURE);
const apiSportsAdapter: SportsDataProvider = {
  name: "api-sports" as const,
  listTeams: () => adapter.listTeams(),
  listSeasonGames: (seasonYear) => adapter.listSeasonGames(seasonYear),
  listLiveGames: () => adapter.listLiveGames(),
  listLiveGamesWithFailures: () =>
    adapter.listLiveGamesWithFailures(),
  getGame: (alias) => adapter.getGame(alias),
  getHealth: () =>
    adapter.getHealth().pipe(
      Effect.map((health) => ({
        ...health,
        provider: "api-sports",
      })),
    ),
};

describe("deployment sports-data provider selection", () => {
  it("constructs the production adapter behind the neutral factory seam", () => {
    const provider = selectSportsDataProvider({
      config: {
        provider: "api-sports",
        apiSportsKey: "test-api-key",
      },
      providers: {
        "api-sports": createApiSportsProviderFactory(),
      },
    });

    expect(provider.name).toBe("api-sports");
  });

  it("selects the one explicitly configured production provider", () => {
    let receivedApiKey: string | undefined;
    expect(
      selectSportsDataProvider({
        config: {
          provider: "api-sports",
          apiSportsKey: "test-api-key",
        },
        providers: {
          "api-sports": ({ apiKey }) => {
            receivedApiKey = apiKey;
            return apiSportsAdapter;
          },
        },
      }),
    ).toBe(apiSportsAdapter);
    expect(receivedApiKey).toBe("test-api-key");
  });

  it("fails closed when provider configuration is missing", () => {
    expect(() =>
      selectSportsDataProvider({
        config: {},
        providers: { "api-sports": () => apiSportsAdapter },
      }),
    ).toThrowError(
      new SportsDataProviderConfigurationError(
        "missing_provider",
        "Sports-data configuration must select one supported provider",
      ),
    );
  });

  it.each(["", "in-memory", "API-SPORTS"])(
    "fails closed for unsupported production provider %j",
    (configuredProvider) => {
      expect(() =>
        selectSportsDataProvider({
          config: {
            provider: configuredProvider,
            apiSportsKey: "test-api-key",
          },
          providers: { "api-sports": () => apiSportsAdapter },
        }),
      ).toThrowError(SportsDataProviderConfigurationError);
    },
  );

  it.each([undefined, "", "   "])(
    "fails closed when API-Sports credentials are missing",
    (apiSportsKey) => {
      expect(() =>
        selectSportsDataProvider({
          config: { provider: "api-sports", apiSportsKey },
          providers: { "api-sports": () => apiSportsAdapter },
        }),
      ).toThrowError(
        new SportsDataProviderConfigurationError(
          "missing_credentials",
          'Credentials are required for sports-data provider "api-sports"',
        ),
      );
    },
  );

  it("fails closed when the selected provider has no registered adapter", () => {
    expect(() =>
      selectSportsDataProvider({
        config: {
          provider: "api-sports",
          apiSportsKey: "test-api-key",
        },
        providers: {},
      }),
    ).toThrowError(
      new SportsDataProviderConfigurationError(
        "provider_not_registered",
        'No adapter is registered for configured sports-data provider "api-sports"',
      ),
    );
  });

  it("fails closed when a registry entry names a different adapter", () => {
    expect(() =>
      selectSportsDataProvider({
        config: {
          provider: "api-sports",
          apiSportsKey: "test-api-key",
        },
        providers: { "api-sports": () => adapter },
      }),
    ).toThrowError(
      new SportsDataProviderConfigurationError(
        "adapter_name_mismatch",
        'Configured sports-data provider "api-sports" does not match adapter "in-memory"',
      ),
    );
  });
});

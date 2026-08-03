import type {
  ApiSportsFetch,
  ApiSportsRequestFence,
} from "../../effect/apiSports/client";
import { ApiSportsProvider } from "../apiSports/adapter";
import type { SportsDataProvider } from "./types";

export type ProductionSportsDataProviderName = "api-sports";

/**
 * Typed deployment configuration supplied by an action/script edge.
 * This pure module deliberately does not read process.env; Convex callers can
 * obtain these values from their generated typed environment.
 */
export type SportsDataDeploymentConfig = Readonly<{
  provider?: string;
  apiSportsKey?: string;
}>;

export type ApiSportsProviderFactory = (input: {
  apiKey: string;
}) => SportsDataProvider;

export function createApiSportsProviderFactory(
  options: Readonly<{
    fetch?: ApiSportsFetch;
    requestFence?: ApiSportsRequestFence;
    nowMs?: () => number;
    teamSeasonYear?: number;
    bootstrapTeamCandidates?: boolean;
  }> = {},
): ApiSportsProviderFactory {
  return ({ apiKey }) =>
    new ApiSportsProvider({
      ...options,
      apiKey,
    });
}

export type SportsDataProviderConfigurationErrorCode =
  | "missing_provider"
  | "unsupported_provider"
  | "missing_credentials"
  | "provider_not_registered"
  | "adapter_name_mismatch";

export class SportsDataProviderConfigurationError extends Error {
  readonly code: SportsDataProviderConfigurationErrorCode;

  constructor(
    code: SportsDataProviderConfigurationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SportsDataProviderConfigurationError";
    this.code = code;
  }
}

export function selectSportsDataProvider(input: {
  config: SportsDataDeploymentConfig;
  providers: Readonly<
    Partial<Record<ProductionSportsDataProviderName, ApiSportsProviderFactory>>
  >;
}): SportsDataProvider {
  const configuredProvider = input.config.provider?.trim();

  if (!configuredProvider) {
    throw new SportsDataProviderConfigurationError(
      "missing_provider",
      "Sports-data configuration must select one supported provider",
    );
  }

  if (configuredProvider !== "api-sports") {
    throw new SportsDataProviderConfigurationError(
      "unsupported_provider",
      `Unsupported sports-data provider "${configuredProvider}"`,
    );
  }

  const apiKey = input.config.apiSportsKey?.trim();
  if (!apiKey) {
    throw new SportsDataProviderConfigurationError(
      "missing_credentials",
      'Credentials are required for sports-data provider "api-sports"',
    );
  }

  const createProvider = input.providers[configuredProvider];
  if (!createProvider) {
    throw new SportsDataProviderConfigurationError(
      "provider_not_registered",
      `No adapter is registered for configured sports-data provider "${configuredProvider}"`,
    );
  }

  const provider = createProvider({ apiKey });
  if (provider.name !== configuredProvider) {
    throw new SportsDataProviderConfigurationError(
      "adapter_name_mismatch",
      `Configured sports-data provider "${configuredProvider}" does not match adapter "${provider.name}"`,
    );
  }

  return provider;
}

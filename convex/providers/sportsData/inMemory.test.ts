import { describe } from "vitest";
import { defineSportsDataProviderContract } from "./testing/contract";
import { InMemorySportsDataProvider } from "./inMemory";

describe("InMemorySportsDataProvider", () => {
  defineSportsDataProviderContract(
    "in-memory adapter",
    "in-memory",
    (fixture) => new InMemorySportsDataProvider(fixture),
  );
});

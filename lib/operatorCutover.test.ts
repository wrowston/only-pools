import { describe, expect, it } from "vitest";

import { canOfferDevelopmentCleanActivation } from "./operatorCutover";

describe("operator cutover activation controls", () => {
  it("offers clean activation only on an explicitly identified development deployment", () => {
    expect(canOfferDevelopmentCleanActivation("development")).toBe(true);
    expect(canOfferDevelopmentCleanActivation("production")).toBe(false);
    expect(canOfferDevelopmentCleanActivation("unconfigured")).toBe(false);
    expect(canOfferDevelopmentCleanActivation(undefined)).toBe(false);
  });
});

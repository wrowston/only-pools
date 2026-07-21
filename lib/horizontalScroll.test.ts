import { describe, expect, it } from "vitest";
import { centeredHorizontalScrollLeft } from "./horizontalScroll";

describe("centeredHorizontalScrollLeft", () => {
  it("centers a target that sits to the right of the viewport", () => {
    // Container 320px wide; target at content x=480, width 48 → center at 504.
    // Desired scrollLeft = 504 - 160 = 344.
    expect(
      centeredHorizontalScrollLeft({
        containerScrollLeft: 0,
        containerLeft: 0,
        containerWidth: 320,
        containerScrollWidth: 800,
        targetLeft: 480,
        targetWidth: 48,
      }),
    ).toBe(344);
  });

  it("accounts for an already-scrolled container via viewport-relative rects", () => {
    // Same geometry as above, but container already scrolled 100px so the
    // target's getBoundingClientRect().left is 380 instead of 480.
    expect(
      centeredHorizontalScrollLeft({
        containerScrollLeft: 100,
        containerLeft: 0,
        containerWidth: 320,
        containerScrollWidth: 800,
        targetLeft: 380,
        targetWidth: 48,
      }),
    ).toBe(344);
  });

  it("clamps to [0, maxScroll]", () => {
    expect(
      centeredHorizontalScrollLeft({
        containerScrollLeft: 0,
        containerLeft: 0,
        containerWidth: 320,
        containerScrollWidth: 400,
        targetLeft: -200,
        targetWidth: 48,
      }),
    ).toBe(0);

    expect(
      centeredHorizontalScrollLeft({
        containerScrollLeft: 0,
        containerLeft: 0,
        containerWidth: 320,
        containerScrollWidth: 400,
        targetLeft: 900,
        targetWidth: 48,
      }),
    ).toBe(80);
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  StatusBannerMessage,
  type ParticipantStatusBanner,
} from "./StatusBannerMessage";

function render(banner: ParticipantStatusBanner) {
  return renderToStaticMarkup(
    createElement(StatusBannerMessage, { banner }),
  );
}

describe("StatusBannerMessage", () => {
  it("announces delayed scores and the last successful update accessibly", () => {
    const lastSuccessfulUpdateAtMs = Date.UTC(
      2026,
      8,
      13,
      17,
      2,
      3,
    );
    const html = render({
      status: "open",
      severity: "critical",
      summary: "Scores are delayed.",
      maintenanceLock: false,
      lastSuccessfulUpdateAtMs,
    });

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Scores are delayed.");
    expect(html).toContain("Last successful live update");
    expect(html).toContain(
      'dateTime="2026-09-13T17:02:03.000Z"',
    );
  });

  it("announces when no successful live update exists", () => {
    const html = render({
      status: "open",
      severity: "critical",
      summary: "Scores are delayed.",
      maintenanceLock: false,
      lastSuccessfulUpdateAtMs: null,
    });
    expect(html).toContain("No successful live update yet.");
    expect(html).not.toContain("<time");
  });

  it("preserves non-watchdog incident copy without fake freshness text", () => {
    const html = render({
      status: "open",
      severity: "critical",
      summary: "Scoring is temporarily delayed.",
      maintenanceLock: false,
    });
    expect(html).toContain("Scoring is temporarily delayed.");
    expect(html).not.toContain("successful live update");
  });
});

import { describe, expect, it } from "vitest";
import {
  formatPickReminderEmail,
  formatPoolUpdateEmail,
  formatWeeklySummaryEmail,
} from "./notificationBodies";
import { escapeHtml, renderNotificationEmailHtml } from "./notificationEmailLayout";

describe("notificationEmailLayout", () => {
  it("escapes HTML in content", () => {
    expect(escapeHtml(`<script>"x"&'`)).toBe(
      "&lt;script&gt;&quot;x&quot;&amp;&#39;",
    );
  });

  it("renders Only Pools card chrome with heat CTA", () => {
    const html = renderNotificationEmailHtml({
      preheader: "Test preheader",
      headline: "Confirm your picks",
      blocks: [{ kind: "paragraph", text: "Body copy here." }],
      cta: { label: "Make picks", href: "https://tryonlypools.com/pools/abc" },
      settingsUrl: "https://tryonlypools.com/settings/notifications",
    });
    expect(html).toContain("Only Pools");
    expect(html).toContain('src="https://tryonlypools.com/brand-mark.png"');
    expect(html).toContain("#fa5d19");
    expect(html).toContain("#f9f9f9");
    expect(html).toContain("#262626");
    expect(html).toContain("Make picks");
    expect(html).toContain("Manage email notifications");
    expect(html).toContain("border-radius:16px");
  });

  it("places the brand mark image beside the Only Pools wordmark", () => {
    const html = renderNotificationEmailHtml({
      preheader: "Preheader",
      headline: "Headline",
      blocks: [],
      settingsUrl: "https://example.test/settings/notifications",
    });
    expect(html).toMatch(
      /brand-mark\.png[^>]*>[\s\S]*?<\/td>\s*<td[^>]*>Only Pools<\/td>/,
    );
  });
});

describe("formatted notification HTML", () => {
  it("includes HTML bodies for each notification type", () => {
    const update = formatPoolUpdateEmail({
      poolName: "Office",
      poolId: "pools_1",
      field: "banner",
      latestText: "Buy-in Friday",
    });
    expect(update.bodyHtml).toContain("Buy-in Friday");
    expect(update.bodyHtml).toContain("Open pool");

    const reminder = formatPickReminderEmail({
      poolName: "Office",
      poolId: "pools_1",
      week: 3,
      incompleteEntryNumbers: [1, 2],
      firstKickoffMs: Date.UTC(2025, 8, 14, 17, 0, 0),
    });
    expect(reminder.bodyHtml).toContain("Picks due soon");
    expect(reminder.bodyHtml).toContain("Make picks");

    const weekly = formatWeeklySummaryEmail({
      week: 3,
      sections: [
        {
          poolName: "Office",
          poolId: "pools_1",
          poolType: "survivor",
          lines: ["Entry 1: advanced (win)"],
        },
      ],
    });
    expect(weekly.bodyHtml).toContain("Week 3 summary");
    expect(weekly.bodyHtml).toContain("View standings");
  });
});

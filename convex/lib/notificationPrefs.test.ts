import { describe, expect, it } from "vitest";
import {
  canDeliverProductEmail,
  DEFAULT_NOTIFICATIONS_FROM_EMAIL,
  DEFAULT_NOTIFICATIONS_REPLY_TO,
  getNotificationsFromEmail,
  getNotificationsReplyTo,
} from "./notificationConfig";
import {
  prefersEmailPickReminders,
  prefersEmailPoolUpdates,
  prefersEmailWeeklySummary,
  resolveNotificationPreferences,
} from "./notificationPrefs";

describe("notificationConfig", () => {
  it("defaults from and reply-to addresses", () => {
    expect(getNotificationsFromEmail({})).toBe(DEFAULT_NOTIFICATIONS_FROM_EMAIL);
    expect(getNotificationsReplyTo({})).toBe(DEFAULT_NOTIFICATIONS_REPLY_TO);
  });

  it("allows product email only in production with Resend key", () => {
    expect(
      canDeliverProductEmail({
        DEPLOYMENT_KIND: "development",
        RESEND_API_KEY: "re_test",
      }),
    ).toBe(false);
    expect(
      canDeliverProductEmail({
        DEPLOYMENT_KIND: "production",
        RESEND_API_KEY: "re_test",
      }),
    ).toBe(true);
    expect(
      canDeliverProductEmail({
        DEPLOYMENT_KIND: "production",
      }),
    ).toBe(false);
  });
});

describe("notificationPrefs", () => {
  it("treats absent prefs as on", () => {
    expect(
      resolveNotificationPreferences({
        emailPickReminders: undefined,
        emailPoolUpdates: undefined,
        emailWeeklySummary: undefined,
      }),
    ).toEqual({
      emailPickReminders: true,
      emailPoolUpdates: true,
      emailWeeklySummary: true,
    });
  });

  it("honors explicit false", () => {
    expect(prefersEmailPickReminders({ emailPickReminders: false })).toBe(
      false,
    );
    expect(prefersEmailPoolUpdates({ emailPoolUpdates: false })).toBe(false);
    expect(prefersEmailWeeklySummary({ emailWeeklySummary: false })).toBe(
      false,
    );
  });
});

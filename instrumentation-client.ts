// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import posthog from "posthog-js";
import {
  CLERK_CLIENT_DENY_URLS,
  CLERK_CLIENT_IGNORE_ERRORS,
  isNoisyClerkClientMessage,
  isNoisyClerkClientUrl,
} from "@/lib/clerkClientNoise";

const isDev = process.env.NODE_ENV === "development";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  environment:
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
    process.env.NEXT_PUBLIC_VERCEL_ENV ??
    process.env.NODE_ENV,

  integrations: [Sentry.replayIntegration()],

  // 100% in development, 10% in production / preview
  tracesSampleRate: isDev ? 1.0 : 0.1,

  enableLogs: true,

  // 10% of all sessions; 100% of sessions with errors
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  // Clerk CDN / session-touch failures are opaque and not actionable for us.
  ignoreErrors: CLERK_CLIENT_IGNORE_ERRORS,
  denyUrls: CLERK_CLIENT_DENY_URLS,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!, {
  api_host: "/ingest",
  ui_host: "https://us.posthog.com",
  defaults: "2026-01-30",
  capture_exceptions: true,
  debug: process.env.NODE_ENV === "development",
  before_send(event) {
    if (!event) return null;
    if (event.event !== "$exception") return event;

    const props = event.properties ?? {};
    const message = String(
      props.$exception_message ??
        props.$exception_list?.[0]?.value ??
        props.$exception_list?.[0]?.type ??
        "",
    );
    const filename = String(
      props.$exception_source ??
        props.$exception_list?.[0]?.frames?.[0]?.filename ??
        "",
    );

    if (
      isNoisyClerkClientMessage(message) ||
      (filename && isNoisyClerkClientUrl(filename))
    ) {
      return null;
    }

    return event;
  },
});

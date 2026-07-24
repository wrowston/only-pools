/** Client-side Help & Feedback diagnostic context — disclosure and payload building. */

export type HelpLane = "support" | "feedback";

export type HelpContextDisclosureItem = {
  label: string;
  value: string;
};

export type HelpContextDisclosure = {
  optionalDiagnostics: HelpContextDisclosureItem[];
  identityContext: HelpContextDisclosureItem[];
};

const APP_VERSION =
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_APP_VERSION?.trim()
    ? process.env.NEXT_PUBLIC_APP_VERSION.trim()
    : "dev";

/** Lightweight browser + OS summary from userAgent (not a full UA dump). */
export function summarizeBrowser(userAgent: string): string {
  const ua = userAgent.trim();
  if (ua.length === 0) return "Unknown browser";

  let browser = "Unknown browser";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\//.test(ua) || /Opera/.test(ua)) browser = "Opera";
  else if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) browser = "Safari";

  let os = "unknown OS";
  if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/Mac OS X|Macintosh/.test(ua)) os = "macOS";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Linux/.test(ua)) os = "Linux";

  return `${browser} on ${os}`;
}

/** Extract Pool id from pathname `/pools/{id}` or `?poolId=` search param. */
export function extractPoolIdFromLocation(
  pathname: string,
  search: string,
): string | undefined {
  const poolPathMatch = pathname.match(/\/pools\/([^/?#]+)/);
  if (poolPathMatch?.[1]) {
    return poolPathMatch[1];
  }

  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  const fromQuery = params.get("poolId")?.trim();
  return fromQuery && fromQuery.length > 0 ? fromQuery : undefined;
}

export type BuildHelpContextInput = {
  lane: HelpLane;
  pathname: string;
  search: string;
  userAgent: string;
  includeDiagnostics: boolean;
  signedIn: boolean;
  signedInEmail: string | null;
  signedInAccountId: string | null;
  anonymousFeedback: boolean;
};

export function buildHelpContextDisclosure(
  input: BuildHelpContextInput,
): HelpContextDisclosure {
  const optionalDiagnostics: HelpContextDisclosureItem[] = [];
  const identityContext: HelpContextDisclosureItem[] = [];

  if (input.includeDiagnostics) {
    const pagePath = `${input.pathname}${input.search}`;
    optionalDiagnostics.push({
      label: "Current page",
      value: pagePath,
    });
    optionalDiagnostics.push({
      label: "Browser and operating system",
      value: summarizeBrowser(input.userAgent),
    });
    optionalDiagnostics.push({
      label: "Application version",
      value: APP_VERSION,
    });
  }

  const showIdentity =
    input.lane === "support" ||
    (input.lane === "feedback" && input.signedIn && !input.anonymousFeedback);

  if (showIdentity && input.signedIn) {
    if (input.signedInAccountId) {
      identityContext.push({
        label: "Account identifier",
        value: input.signedInAccountId,
      });
    }
    if (input.signedInEmail) {
      identityContext.push({
        label: "Account email",
        value: input.signedInEmail,
      });
    }

    const poolId = extractPoolIdFromLocation(input.pathname, input.search);
    if (poolId) {
      identityContext.push({
        label: "Pool identifier",
        value: poolId,
      });
    }
  }

  return { optionalDiagnostics, identityContext };
}

export type HelpClientContextPayload = {
  includeDiagnostics: boolean;
  context: Record<string, string>;
  poolIdHint?: string;
};

/** Build the JSON body fields sent to `/help/intake` (client-side only). */
export function buildHelpClientContextPayload(
  input: BuildHelpContextInput,
): HelpClientContextPayload {
  const context: Record<string, string> = {};

  if (input.includeDiagnostics) {
    context.pagePath = `${input.pathname}${input.search}`;
    context.browserSummary = summarizeBrowser(input.userAgent);
    context.appVersion = APP_VERSION;
  }

  const poolIdHint = extractPoolIdFromLocation(input.pathname, input.search);

  return {
    includeDiagnostics: input.includeDiagnostics,
    context,
    poolIdHint,
  };
}

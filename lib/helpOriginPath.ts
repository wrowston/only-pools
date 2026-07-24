/** Stash the last non-help route so /help diagnostics can report useful page context. */

export const HELP_ORIGIN_PATH_STORAGE_KEY = "help-origin-path";

export type HelpOriginPath = {
  pathname: string;
  search: string;
};

export function isHelpRoute(pathname: string): boolean {
  return pathname === "/help" || pathname.startsWith("/help/");
}

function normalizeSearch(search: string): string {
  if (search.length === 0) return "";
  return search.startsWith("?") ? search : `?${search}`;
}

export function writeHelpOriginPath(pathname: string, search = ""): void {
  if (typeof window === "undefined") return;
  if (isHelpRoute(pathname)) return;

  const payload: HelpOriginPath = {
    pathname,
    search: normalizeSearch(search),
  };
  try {
    sessionStorage.setItem(
      HELP_ORIGIN_PATH_STORAGE_KEY,
      JSON.stringify(payload),
    );
  } catch {
    // Ignore quota / private-mode failures.
  }
}

export function readHelpOriginPath(): HelpOriginPath | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(HELP_ORIGIN_PATH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HelpOriginPath;
    if (
      parsed &&
      typeof parsed.pathname === "string" &&
      parsed.pathname.length > 0 &&
      typeof parsed.search === "string" &&
      !isHelpRoute(parsed.pathname)
    ) {
      return {
        pathname: parsed.pathname,
        search: normalizeSearch(parsed.search),
      };
    }
  } catch {
    // Ignore malformed payloads.
  }
  return null;
}

/** Prefer a stashed origin when the user is already on /help. */
export function resolveHelpDiagnosticLocation(current: HelpOriginPath): HelpOriginPath {
  if (!isHelpRoute(current.pathname)) {
    return {
      pathname: current.pathname,
      search: normalizeSearch(current.search),
    };
  }
  return readHelpOriginPath() ?? {
    pathname: current.pathname,
    search: normalizeSearch(current.search),
  };
}

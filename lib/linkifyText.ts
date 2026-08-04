export type LinkifySegment =
  | { type: "text"; value: string }
  | { type: "url"; value: string; href: string };

/** http(s) URLs; trailing punctuation is left as plain text. */
const URL_PATTERN = /\bhttps?:\/\/[^\s<>()[\]{}'"]+/gi;

const TRAILING_PUNCTUATION = /[.,;:!?)]+$/;

function splitUrlMatch(raw: string): { url: string; trailing: string } {
  const trailingMatch = raw.match(TRAILING_PUNCTUATION);
  if (!trailingMatch) {
    return { url: raw, trailing: "" };
  }
  const trailing = trailingMatch[0];
  return {
    url: raw.slice(0, raw.length - trailing.length),
    trailing,
  };
}

/**
 * Split plain text into text and http(s) URL segments for safe link rendering.
 * Only `http:` / `https:` schemes are recognized.
 */
export function linkifyText(text: string): LinkifySegment[] {
  if (text.length === 0) {
    return [{ type: "text", value: "" }];
  }

  const segments: LinkifySegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0];
    const start = match.index ?? 0;
    if (start > cursor) {
      segments.push({ type: "text", value: text.slice(cursor, start) });
    }

    const { url, trailing } = splitUrlMatch(raw);
    if (url.length > 0) {
      segments.push({ type: "url", value: url, href: url });
    }
    if (trailing.length > 0) {
      segments.push({ type: "text", value: trailing });
    }

    cursor = start + raw.length;
  }

  if (cursor < text.length) {
    segments.push({ type: "text", value: text.slice(cursor) });
  }

  if (segments.length === 0) {
    return [{ type: "text", value: text }];
  }

  return segments;
}

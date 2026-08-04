/**
 * HTML email shell matching Only Pools visual tokens.
 * Inspired by clean transactional card mail (Link-style hierarchy),
 * but uses OP canvas / heat / Satoshi-like stack — not a copy.
 */

const COLORS = {
  canvas: "#f9f9f9",
  surface: "#ffffff",
  text: "#262626",
  secondary: "#262626a3",
  muted: "#2626267a",
  border: "#ededed",
  heat: "#fa5d19",
  heatHover: "#e55416",
  selectedFg: "#c44512",
} as const;

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function brandMarkSvg(): string {
  // Bracket glyph — same paths as components/BrandMark.tsx
  return `<svg width="20" height="20" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;">
  <path d="M1.5 2H5.5V5H9.5 M1.5 8H5.5V5 M1.5 10H5.5V13H9.5 M1.5 16H5.5V13 M9.5 5V13 M9.5 9H16.5" stroke="${COLORS.heat}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

export type EmailCta = {
  label: string;
  href: string;
};

export type EmailBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "section"; title: string; lines: string[]; href?: string; hrefLabel?: string };

/**
 * Wrap notification content in the Only Pools email card.
 */
export function renderNotificationEmailHtml(args: {
  preheader: string;
  headline: string;
  blocks: EmailBlock[];
  cta?: EmailCta;
  settingsUrl: string;
}): string {
  const preheader = escapeHtml(args.preheader);
  const headline = escapeHtml(args.headline);

  const blocksHtml = args.blocks
    .map((block) => {
      if (block.kind === "paragraph") {
        return `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:${COLORS.secondary};">${escapeHtml(block.text)}</p>`;
      }
      if (block.kind === "quote") {
        return `<div style="margin:0 0 20px;padding:14px 16px;border-radius:10px;background:${COLORS.canvas};border:1px solid ${COLORS.border};font-size:15px;line-height:1.55;color:${COLORS.text};white-space:pre-wrap;">${escapeHtml(block.text)}</div>`;
      }
      if (block.kind === "list") {
        const items = block.items
          .map(
            (item) =>
              `<li style="margin:0 0 6px;font-size:15px;line-height:1.5;color:${COLORS.secondary};">${escapeHtml(item)}</li>`,
          )
          .join("");
        return `<ul style="margin:0 0 20px;padding:0 0 0 18px;">${items}</ul>`;
      }
      // section
      const lines = block.lines
        .map(
          (line) =>
            `<p style="margin:0 0 6px;font-size:14px;line-height:1.5;color:${COLORS.secondary};">${escapeHtml(line)}</p>`,
        )
        .join("");
      const link =
        block.href && block.hrefLabel
          ? `<p style="margin:10px 0 0;"><a href="${escapeHtml(block.href)}" style="color:${COLORS.heat};text-decoration:underline;font-size:14px;font-weight:500;">${escapeHtml(block.hrefLabel)}</a></p>`
          : "";
      return `<div style="margin:0 0 20px;padding:16px;border-radius:10px;border:1px solid ${COLORS.border};background:${COLORS.surface};">
  <p style="margin:0 0 10px;font-size:15px;font-weight:500;letter-spacing:-0.02em;color:${COLORS.text};">${escapeHtml(block.title)}</p>
  ${lines}
  ${link}
</div>`;
    })
    .join("\n");

  const ctaHtml = args.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 28px;">
  <tr>
    <td style="border-radius:10px;background:${COLORS.heat};">
      <a href="${escapeHtml(args.cta.href)}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:500;letter-spacing:-0.01em;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(args.cta.label)}</a>
    </td>
  </tr>
</table>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${headline}</title>
  <!--[if mso]><style>body,table,td{font-family:Arial,sans-serif!important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:${COLORS.canvas};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.canvas};">
    <tr>
      <td align="center" style="padding:28px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:16px;">
          <tr>
            <td style="padding:28px 28px 8px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right:8px;vertical-align:middle;">${brandMarkSvg()}</td>
                  <td style="vertical-align:middle;font-family:${FONT_STACK};font-size:15px;font-weight:500;letter-spacing:-0.02em;color:${COLORS.text};">Only Pools</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 8px;font-family:${FONT_STACK};">
              <h1 style="margin:0 0 14px;font-size:22px;line-height:1.25;font-weight:500;letter-spacing:-0.03em;color:${COLORS.text};">${headline}</h1>
              ${blocksHtml}
              ${ctaHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 28px;font-family:${FONT_STACK};">
              <div style="border-top:1px solid ${COLORS.border};padding-top:18px;">
                <p style="margin:0 0 8px;font-size:12px;line-height:1.45;color:${COLORS.muted};">
                  You’re receiving this because you’re in an Only Pools competition.
                </p>
                <p style="margin:0;font-size:12px;line-height:1.45;color:${COLORS.muted};">
                  <a href="${escapeHtml(args.settingsUrl)}" style="color:${COLORS.selectedFg};text-decoration:underline;">Manage email notifications</a>
                </p>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

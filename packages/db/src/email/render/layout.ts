// The one email layout (EMAIL-01, UI-SPEC "Emails" + "Color › Email", D-UI-P6-33). A 600px
// single-column table, inline styles, system fonts, a text wordmark, one bulletproof button
// (min-height 44px), a hidden preheader, and a footer with why-you-got-this + the CDS postal
// address (DRAFT until CDS_POSTAL_ADDRESS is set, GO-LIVE). One image (the A&M logo), no web fonts.
// bodyHtml / footerHtml arrive already escaped; everything substituted here is escaped.
import { escapeHtml } from "@cds/core/email";
import { postalAddress } from "../env";

export const EMAIL_COLORS = {
  ground: "#F2F2EF",
  card: "#FFFFFF",
  ink: "#1B1B19",
  muted: "#5B5B56",
  button: "#1F5F8B",
  buttonText: "#FFFFFF",
  link: "#1F5F8B",
} as const;

/** The A&M logo at the top of every email (absolute URL). The plain-text part is unchanged. */
export const EMAIL_LOGO = {
  src: "https://barber.needtobeedgy.com/am-barber/logo.png",
  href: "https://barber.needtobeedgy.com/",
  alt: "A&M Barber Studio",
  width: 160,
} as const;

const DEFAULT_BRAND = "A&M Barber Studio";

export const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export type LayoutOptions = {
  preheader: string;
  /** Escaped HTML paragraphs above the button. */
  bodyHtml: string;
  bodyText: string;
  button?: { label: string; href: string };
  /** Escaped HTML shown after the button (optional). */
  afterHtml?: string;
  afterText?: string;
  footerHtml: string;
  footerText: string;
  /** Text brand (plain text + footer); defaults to A&M Barber Studio. */
  brand?: string;
};

/** Only absolute http(s) links go into an email (T-06-25). */
export function safeHref(href: string): string {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    throw new Error("email link is not a URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error("email link must be http(s)");
  }
  return u.toString();
}

export function paragraph(html: string, muted = false): string {
  const color = muted ? EMAIL_COLORS.muted : EMAIL_COLORS.ink;
  return `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:${color}">${html}</p>`;
}

export function textLink(label: string, href: string): string {
  return `<a href="${escapeHtml(safeHref(href))}" style="color:${EMAIL_COLORS.link};text-decoration:underline">${escapeHtml(label)}</a>`;
}

function buttonHtml(label: string, href: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px"><tr>` +
    `<td style="border-radius:6px;background:${EMAIL_COLORS.button}">` +
    `<a href="${escapeHtml(safeHref(href))}" style="display:inline-block;min-height:44px;line-height:44px;padding:0 24px;` +
    `background:${EMAIL_COLORS.button};color:${EMAIL_COLORS.buttonText};border-radius:6px;font-size:16px;font-weight:600;` +
    `text-decoration:none;font-family:${FONT_STACK}">${escapeHtml(label)}</a>` +
    `</td></tr></table>`
  );
}

export function layout(opts: LayoutOptions): { html: string; text: string } {
  const brand = opts.brand?.trim() || DEFAULT_BRAND;
  const address = postalAddress();
  const button = opts.button
    ? buttonHtml(opts.button.label, opts.button.href)
    : "";
  const html =
    `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<meta name="color-scheme" content="light only">\n<meta name="supported-color-schemes" content="light">\n` +
    `<title>${escapeHtml(opts.preheader)}</title>\n` +
    `<style>@media (max-width:480px){.cds-card{padding:24px !important}}</style>\n</head>\n` +
    `<body style="margin:0;padding:0;background:${EMAIL_COLORS.ground};font-family:${FONT_STACK}">\n` +
    `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all">${escapeHtml(opts.preheader)}</div>\n` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${EMAIL_COLORS.ground}"><tr><td align="center" style="padding:32px 8px">\n` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">\n` +
    `<tr><td align="center" style="padding:0 0 16px;text-align:center"><a href="${EMAIL_LOGO.href}" style="text-decoration:none">` +
    `<img src="${EMAIL_LOGO.src}" alt="${escapeHtml(EMAIL_LOGO.alt)}" width="${EMAIL_LOGO.width}" ` +
    `style="display:block;margin:0 auto;width:${EMAIL_LOGO.width}px;max-width:100%;height:auto;border:0"></a></td></tr>\n` +
    `<tr><td class="cds-card" style="background:${EMAIL_COLORS.card};border-radius:8px;padding:32px">\n` +
    opts.bodyHtml +
    button +
    (opts.afterHtml ?? "") +
    `\n</td></tr>\n` +
    `<tr><td style="padding:24px 0 0;font-size:14px;line-height:1.5;color:${EMAIL_COLORS.muted}">\n` +
    opts.footerHtml +
    `<p style="margin:0">${escapeHtml(brand)}<br>${escapeHtml(address)}</p>\n` +
    `</td></tr>\n</table>\n</td></tr></table>\n</body>\n</html>\n`;

  const parts = [brand, "", opts.bodyText.trim()];
  if (opts.button) {
    parts.push("", `${opts.button.label}:`, safeHref(opts.button.href));
  }
  if (opts.afterText) parts.push("", opts.afterText.trim());
  parts.push("", "--", opts.footerText.trim());
  parts.push(brand, address);
  return { html, text: parts.join("\n") + "\n" };
}

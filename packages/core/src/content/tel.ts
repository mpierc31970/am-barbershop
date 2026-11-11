// The one `tel:` href builder (08-REVIEW CR-B02, IN-B04). The intake phone validator accepts
// an extension (`x 42`, `ext 42`, `ext. 42`; intake/validate.ts), so the extension is split
// off and sent as an RFC 3966 `;ext=` parameter instead of being dialed as part of the
// number. Pure; used by the Contact preset, @cds/templates and the ui site renderer.

const EXTENSION = /^(.*?)\s*(?:x|ext\.?)\s*(\d{1,6})\s*$/i;

/**
 * A `tel:` href from a displayed phone: digits with one leading `+` kept, an extension as
 * `;ext=<digits>`; "" when the number part holds no digits (or the value is not a string).
 */
export function telHref(phone: unknown): string {
  if (typeof phone !== "string") return "";
  const m = EXTENSION.exec(phone.trim());
  const number = m ? m[1]! : phone;
  const digits = number.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  if (!/\d/.test(digits)) return "";
  return m ? `tel:${digits};ext=${m[2]}` : `tel:${digits}`;
}

// Header sanitising and HTML escaping (RESEARCH Pitfall 11, T-06-09, T-06-10). Pure; uses only
// TextEncoder and btoa, so it runs in Edge, the browser and Node.

/** Strips CR, LF, NUL and every C0/DEL control (replaced by a space), trims, caps at 998. */
export function headerValue(raw: string): string {
  return String(raw)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim()
    .slice(0, 998);
}

function base64Utf8(s: string): string {
  let bin = "";
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** `"Name" <address>`, RFC 2047 encoded-word for non-ASCII names. */
export function formatAddress(name: string, address: string): string {
  const addr = headerValue(address).replace(/[<>\s]/g, "");
  const n = headerValue(name);
  if (n === "") return `<${addr}>`;
  if (/^[\x20-\x7e]*$/.test(n)) {
    return `"${n.replace(/["\\]/g, "\\$&")}" <${addr}>`;
  }
  return `=?UTF-8?B?${base64Utf8(n)}?= <${addr}>`;
}

const HTML: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Every substitution into an email's HTML goes through this. */
export function escapeHtml(raw: string): string {
  return String(raw).replace(/[&<>"']/g, (c) => HTML[c]!);
}

// Where /staff/sign-in sends staff afterwards (13-21 choice 2; T-13-21-02). Only a
// same-origin console path is allowed: it must be `/staff` or start `/staff/` or `/staff?`,
// with no `//`, no backslash, no scheme and no control characters. Anything else is null
// and the caller uses `/staff`. Pure: pages, actions and tests import it.

const MAX_NEXT = 2048;

/** The validated `next` target, or null (the caller then uses `/staff`). */
export function safeStaffNext(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_NEXT) {
    return null;
  }
  if (!/^\/staff(?:$|[/?#])/.test(raw)) return null;
  if (raw.includes("//") || raw.includes("\\")) return null;
  // Control characters (and spaces browsers strip) can smuggle a different target.
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c <= 0x20 || c === 0x7f) return null;
  }
  if (/%(?:2f|5c|00)/i.test(raw.split(/[?#]/, 1)[0] ?? "")) return null;
  if (/^\/staff\/(?:\.|%2e)/i.test(raw)) return null;
  // Never back to the sign-in page itself (a loop after signing in).
  if (/^\/staff\/sign-in(?:$|[/?#])/.test(raw)) return null;
  return raw;
}

/** The sign-in page link that comes back to `path` (validated; plain sign-in otherwise). */
export function staffSignInHrefFor(path: string | null | undefined): string {
  const next = safeStaffNext(path);
  return next
    ? `/staff/sign-in?next=${encodeURIComponent(next)}`
    : "/staff/sign-in";
}

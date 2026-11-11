// Consent SSR scan (07-14; CONT-34, D279, RESEARCH Pitfall 7). Test-only: nothing in the
// package entry points imports this file. Reuse in 07-23, 07-24, 07-33.
//
// thirdPartyLoads(html) returns the frame hosts that server markup would contact before
// consent: hosts in loading contexts only (src, srcset, poster, data, background,
// <link href>, url(…), <meta http-equiv="refresh">). A plain <a href> makes no request until
// clicked, so it is not reported (choice 1), and neither is prose naming a host.
import { CONSENT_FRAME_HOSTS } from "@cds/core/content";

const ATTR =
  /(?:^|[\s"'<])(src|srcset|poster|data|background)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/gi;
const LINK_HREF =
  /<link\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/gi;
const CSS_URL = /url\(\s*(?:&quot;|&#x27;|&#39;|["'])?\s*([^"')\s]+)/gi;
const META_REFRESH = /<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi;
const REFRESH_URL = /url\s*=\s*([^"'>;\s]+)/i;

function decode(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'");
}

function hostOf(value: string): string | null {
  try {
    return new URL(
      decode(value).trim(),
      "https://tenant.invalid",
    ).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function thirdPartyLoads(
  html: string,
  hosts: readonly string[] = CONSENT_FRAME_HOSTS,
): string[] {
  const wanted = new Set(hosts.map((h) => h.toLowerCase()));
  const candidates: string[] = [];
  for (const m of html.matchAll(ATTR)) {
    const name = (m[1] ?? "").toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? "";
    if (name === "srcset") {
      for (const part of decode(value).split(",")) {
        const url = part.trim().split(/\s+/)[0];
        if (url) candidates.push(url);
      }
    } else {
      candidates.push(value);
    }
  }
  for (const m of html.matchAll(LINK_HREF)) {
    candidates.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  for (const m of html.matchAll(CSS_URL)) candidates.push(m[1] ?? "");
  for (const m of html.matchAll(META_REFRESH)) {
    const url = REFRESH_URL.exec(m[0]);
    if (url?.[1]) candidates.push(url[1]);
  }
  const found = new Set<string>();
  for (const c of candidates) {
    const host = hostOf(c);
    if (host && wanted.has(host)) found.add(host);
  }
  return [...found];
}

// Installable hub (11-22; DASH-34, D63; 11-UI-SPEC "Push" hub manifest). Pure builders for
// the per-org web app manifest, the neutral monogram icon and the service worker script. The
// routes (/hub/manifest.webmanifest, /hub/icon/<file>, /hub/sw.js) add the session and headers.
// Never a CDS mark: the icon is the business's generated site icon or its initials.

export const HUB_THEME_COLOR = "#F2F2EF";
export const HUB_BACKGROUND_COLOR = "#FFFFFF";
const MONOGRAM_INK = "#1B1B19";
export const HUB_START_URL = "/hub/today";
export const HUB_SCOPE = "/hub/";
export const SHORT_NAME_MAX = 12;

export type HubManifestIcon = {
  src: string;
  sizes: string;
  type: string;
  purpose: "any" | "maskable";
};

export type HubManifest = {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: "standalone";
  background_color: string;
  theme_color: string;
  icons: HubManifestIcon[];
};

/** ≤ 12 characters: the whole name, else its first word, else the name cut at 12. */
export function shortNameOf(name: string): string {
  const clean = name.replace(/\s+/g, " ").trim() || "Your site";
  if (clean.length <= SHORT_NAME_MAX) return clean;
  const first = clean.split(" ")[0] ?? "";
  if (first.length >= 3 && first.length <= SHORT_NAME_MAX) return first;
  return clean.slice(0, SHORT_NAME_MAX).trim();
}

/** Up to two initials, letters or digits only; "?" never shows (falls back to "S"). */
export function monogramInitials(name: string): string {
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  const letters = words
    .slice(0, 2)
    .map((w) => Array.from(w)[0] ?? "")
    .join("")
    .toUpperCase();
  return letters || "S";
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * A neutral square with the business initials (ink on #F2F2EF). The text sits well inside the
 * 80% maskable safe zone, so one file serves both purposes.
 */
export function monogramSvg(name: string): string {
  const text = xmlEscape(monogramInitials(name));
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">' +
    `<rect width="512" height="512" fill="${HUB_THEME_COLOR}"/>` +
    `<text x="256" y="256" dy="0.35em" text-anchor="middle" font-family="system-ui,-apple-system,'Segoe UI',sans-serif" font-size="184" font-weight="600" fill="${MONOGRAM_INK}">${text}</text>` +
    "</svg>"
  );
}

/** The org's manifest. `iconVersion` = the generated site-icon set's `v`, or null for none. */
export function buildHubManifest(input: {
  name: string;
  iconVersion: string | null;
}): HubManifest {
  const name = input.name.replace(/\s+/g, " ").trim() || "Your site";
  const icons: HubManifestIcon[] = input.iconVersion
    ? [
        {
          src: `/hub/icon/icon-512.png?v=${encodeURIComponent(input.iconVersion)}`,
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        },
        {
          src: `/hub/icon/icon-512.png?v=${encodeURIComponent(input.iconVersion)}`,
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
        {
          src: `/hub/icon/icon-180.png?v=${encodeURIComponent(input.iconVersion)}`,
          sizes: "180x180",
          type: "image/png",
          purpose: "any",
        },
      ]
    : [
        {
          src: "/hub/icon/monogram.svg",
          sizes: "any",
          type: "image/svg+xml",
          purpose: "any",
        },
        {
          src: "/hub/icon/monogram.svg",
          sizes: "any",
          type: "image/svg+xml",
          purpose: "maskable",
        },
      ];
  return {
    id: HUB_START_URL,
    name,
    short_name: shortNameOf(name),
    start_url: HUB_START_URL,
    scope: HUB_SCOPE,
    display: "standalone",
    background_color: HUB_BACKGROUND_COLOR,
    theme_color: HUB_THEME_COLOR,
    icons,
  };
}

/**
 * The hub service worker (T-11-22-02). Push only: no caching, no offline, no fetch handler.
 * - push: shows the payload {title, org, body, href, tag}; the tag (`org:type`) replaces an
 *   older notification of the same type from the same site without re-alerting (renotify false).
 * - notificationclick: opens only same-origin `/hub/` paths (anything else → /hub/today), through
 *   /hub/switch when the payload names its org (WR-C01: a multi-site person lands in the site
 *   that raised the alert); focuses an open hub window and navigates it, else opens a new one.
 */
export const HUB_SERVICE_WORKER = `// CDS hub service worker (11-22). Push only: no caching, no offline.
"use strict";
var HUB_PREFIX = "/hub/";
var FALLBACK = "/hub/today";

function safeHref(raw) {
  if (typeof raw !== "string" || raw.length > 300) return FALLBACK;
  if (raw.indexOf(HUB_PREFIX) !== 0 || raw.indexOf("//") !== -1 || raw.indexOf("\\\\") !== -1) {
    return FALLBACK;
  }
  // WR-C03 (mirrors isHubHref): no dot segment, raw or encoded, and no encoded slash.
  var path = raw.split(/[?#]/, 1)[0];
  if (/(?:^|\\/)(?:\\.|%2e){1,2}(?:\\/|$)/i.test(path) || /%(?:2f|5c)/i.test(path)) {
    return FALLBACK;
  }
  return raw;
}

// WR-C01: a record id names the org that raised the alert; anything else is ignored.
function safeOrg(raw) {
  return typeof raw === "string" && /^[a-z0-9]{15}$/.test(raw) ? raw : "";
}

// Open the link in the alert's own site: /hub/switch checks the membership, sets the site
// and redirects to the (re-checked) link. No org: the link opens as is.
function openHref(href, org) {
  return org ? "/hub/switch?org=" + org + "&next=" + encodeURIComponent(href) : href;
}

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  var title = typeof data.title === "string" && data.title ? data.title : "Your site";
  var org = safeOrg(data.org);
  var tag = typeof data.tag === "string" && data.tag ? data.tag : "alert";
  var options = {
    body: typeof data.body === "string" ? data.body : "",
    tag: org ? org + ":" + tag : tag,
    renotify: false,
    icon: "/hub/icon/icon-180.png",
    data: { href: safeHref(data.href), org: org }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var data = event.notification.data || {};
  var href = openHref(safeHref(data.href), safeOrg(data.org));
  var target = new URL(href, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        var url = new URL(c.url);
        if (url.origin === self.location.origin && url.pathname.indexOf("/hub") === 0) {
          return c
            .focus()
            .then(function (w) {
              return w && "navigate" in w ? w.navigate(target) : self.clients.openWindow(target);
            })
            .catch(function () {
              return self.clients.openWindow(target);
            });
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
`;

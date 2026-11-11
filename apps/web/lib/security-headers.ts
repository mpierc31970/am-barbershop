// Response security headers (WR-B06), set by the middleware on every routed response.
// Edge-safe: no imports.

/**
 * A conservative CSP (WR-B06): no framing by any origin (clickjacking of Publish, the
 * pop-up Show switch, Create page), no plugins, no <base> hijack. It does not restrict
 * scripts, styles or images on tenant sites: tenant content uses images from any https
 * host. Tenant sites are not framed by anything either (nothing in the platform embeds
 * them). form-action is left open on purpose: a future Server Action may redirect to a
 * tenant's own payment gateway (D296).
 */
export const CONTENT_SECURITY_POLICY =
  "frame-ancestors 'none'; object-src 'none'; base-uri 'self'";

/** The one third-party origin the platform loads code from: Cloudflare Turnstile (D213). */
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/**
 * The consent frame origins (07-23 choice 8, T-07-23-06): https + each 07-14
 * CONSENT_FRAME_HOSTS entry, same order. Copied, not imported: this file stays import-free
 * and Edge-safe; security-headers.test.ts pins it to CONSENT_FRAME_HOSTS.
 */
export const CONSENT_FRAME_ORIGINS: readonly string[] = Object.freeze([
  "https://www.youtube-nocookie.com",
  "https://i.ytimg.com",
  "https://player.vimeo.com",
  "https://fast.wistia.net",
  "https://www.loom.com",
  "https://www.facebook.com",
  "https://www.instagram.com",
  "https://platform.twitter.com",
  "https://www.tiktok.com",
  "https://open.spotify.com",
  "https://w.soundcloud.com",
  "https://embed.podcasts.apple.com",
  "https://calendly.com",
  "https://calendar.google.com",
  "https://maps.google.com",
  "https://www.google.com",
]);

/**
 * The platform host's CSP (06-15, T-06-75): the base policy plus script-src limited to the
 * app itself and Turnstile at https://challenges.cloudflare.com (the /start save card's bot
 * check, script and widget iframe). frame-src is the app, Turnstile and the consent frame
 * origins (07-23): the hub's Play preview and the builder page preview load the same
 * consented provider frames a tenant site does. No other origin and no wildcard. Tenant
 * hosts keep the base policy (unchanged). 'unsafe-inline' stays because Next's inline bootstrap scripts
 * have no nonces yet; 'unsafe-eval' only in development (React refresh needs it).
 */
export function platformContentSecurityPolicy(
  dev: boolean = process.env.NODE_ENV === "development",
): string {
  const scripts = [
    "'self'",
    "'unsafe-inline'",
    ...(dev ? ["'unsafe-eval'"] : []),
    TURNSTILE_ORIGIN,
  ];
  return [
    CONTENT_SECURITY_POLICY,
    `script-src ${scripts.join(" ")}`,
    `frame-src 'self' ${TURNSTILE_ORIGIN} ${CONSENT_FRAME_ORIGINS.join(" ")}`,
  ].join("; ");
}

export function securityHeaders(
  kind: "platform" | "tenant" | "invalid",
): Record<string, string> {
  return {
    "Content-Security-Policy":
      kind === "platform"
        ? platformContentSecurityPolicy()
        : CONTENT_SECURITY_POLICY,
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    // The hub never leaks its URLs (page ids, preview paths) to other origins. Tenant sites
    // keep the browser default, so outbound links still carry the site's origin.
    "Referrer-Policy":
      kind === "tenant" ? "strict-origin-when-cross-origin" : "same-origin",
  };
}

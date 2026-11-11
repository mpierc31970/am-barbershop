// Security headers (WR-B06) and the 06-15 Turnstile allowance (T-06-75): the platform CSP
// allows scripts and frames from the app and https://challenges.cloudflare.com only, with
// no wildcard; tenant sites keep the base policy.
import { CONSENT_FRAME_HOSTS } from "@cds/core/content";
import { describe, expect, it } from "vitest";
import {
  CONSENT_FRAME_ORIGINS,
  CONTENT_SECURITY_POLICY,
  platformContentSecurityPolicy,
  securityHeaders,
  TURNSTILE_ORIGIN,
} from "../lib/security-headers";

function directive(csp: string, name: string): string[] | null {
  const part = csp
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${name} `));
  return part ? part.split(/\s+/).slice(1) : null;
}

describe("platform CSP", () => {
  const csp = platformContentSecurityPolicy(false);

  it("keeps the base policy", () => {
    expect(csp.startsWith(CONTENT_SECURITY_POLICY)).toBe(true);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it("script-src allows the app and challenges.cloudflare.com only; frame-src adds the consent frames", () => {
    expect(TURNSTILE_ORIGIN).toBe("https://challenges.cloudflare.com");
    expect(directive(csp, "script-src")).toEqual([
      "'self'",
      "'unsafe-inline'",
      "https://challenges.cloudflare.com",
    ]);
    expect(directive(csp, "frame-src")).toEqual([
      "'self'",
      "https://challenges.cloudflare.com",
      ...CONSENT_FRAME_ORIGINS,
    ]);
  });

  it("CONSENT_FRAME_ORIGINS is pinned to CONSENT_FRAME_HOSTS (07-23 drift test)", () => {
    expect(CONSENT_FRAME_ORIGINS).toEqual(
      CONSENT_FRAME_HOSTS.map((h) => `https://${h}`),
    );
    const frames = directive(csp, "frame-src") ?? [];
    for (const host of CONSENT_FRAME_HOSTS) {
      expect(frames).toContain(`https://${host}`);
    }
    expect(frames.length).toBe(2 + CONSENT_FRAME_HOSTS.length);
  });

  it("adds no wildcard origin and no other host", () => {
    expect(csp).not.toMatch(/\*/);
    const hosts = csp.match(/https?:\/\/[^\s;]+/g) ?? [];
    expect(new Set(hosts)).toEqual(
      new Set([TURNSTILE_ORIGIN, ...CONSENT_FRAME_ORIGINS]),
    );
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it("allows eval only in development", () => {
    expect(
      directive(platformContentSecurityPolicy(true), "script-src"),
    ).toContain("'unsafe-eval'");
  });
});

describe("securityHeaders", () => {
  it("platform responses carry the Turnstile allowance", () => {
    const h = securityHeaders("platform");
    expect(h["Content-Security-Policy"]).toContain(
      "script-src 'self' 'unsafe-inline'",
    );
    expect(h["Content-Security-Policy"]).toContain(
      "frame-src 'self' https://challenges.cloudflare.com https://www.youtube-nocookie.com",
    );
    expect(h["Referrer-Policy"]).toBe("same-origin");
  });

  it("tenant and invalid hosts keep the base policy", () => {
    expect(securityHeaders("tenant")["Content-Security-Policy"]).toBe(
      CONTENT_SECURITY_POLICY,
    );
    expect(securityHeaders("invalid")["Content-Security-Policy"]).toBe(
      CONTENT_SECURITY_POLICY,
    );
  });
});

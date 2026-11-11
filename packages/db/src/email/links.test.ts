// Signed links and env helpers (EMAIL-01, D-UI-P6-15, T-06-23; PD-13).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  linkSecret,
  mailDomain,
  platformUrl,
  postalAddress,
  supportEmail,
} from "./env";
import { signLink, verifyLink } from "./links";

const ENV_KEYS = [
  "CDS_ENV",
  "CDS_LINK_SECRET",
  "CDS_PLATFORM_URL",
  "CDS_MAIL_DOMAIN",
  "CDS_SUPPORT_EMAIL",
  "CDS_POSTAL_ADDRESS",
];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const NOW = 1_800_000_000;

describe("signLink / verifyLink (T-06-23)", () => {
  it("round-trips purpose, id and expiry", () => {
    const t = signLink("unsub", "q123", NOW + 60);
    expect(verifyLink(t, "unsub", NOW)).toEqual({ id: "q123", exp: NOW + 60 });
  });

  it("rejects the wrong purpose", () => {
    const t = signLink("unsub", "q123", NOW + 60);
    expect(verifyLink(t, "confirm", NOW)).toBeNull();
  });

  it("rejects an expired link", () => {
    const t = signLink("unsub", "q123", NOW + 60);
    expect(verifyLink(t, "unsub", NOW + 60)).toBeNull();
    expect(verifyLink(t, "unsub", NOW + 61)).toBeNull();
  });

  it("rejects any single flipped character", () => {
    const t = signLink("unsub", "q123", NOW + 60);
    for (let i = 0; i < t.length; i++) {
      const c = t[i] === "A" ? "B" : "A";
      const bad = t.slice(0, i) + c + t.slice(i + 1);
      if (bad === t) continue;
      expect(verifyLink(bad, "unsub", NOW), `index ${i}`).toBeNull();
    }
  });

  it("rejects malformed input", () => {
    expect(verifyLink("nodot", "unsub", NOW)).toBeNull();
    expect(verifyLink("a.b.c", "unsub", NOW)).toBeNull();
    expect(verifyLink("x".repeat(1025), "unsub", NOW)).toBeNull();
    expect(verifyLink("", "unsub", NOW)).toBeNull();
    expect(verifyLink(42 as unknown as string, "unsub", NOW)).toBeNull();
  });

  it("rejects a link signed with another secret", () => {
    process.env.CDS_LINK_SECRET = "a".repeat(40);
    const t = signLink("unsub", "q123", NOW + 60);
    process.env.CDS_LINK_SECRET = "b".repeat(40);
    expect(verifyLink(t, "unsub", NOW)).toBeNull();
  });

  it("refuses unsafe ids and purposes when signing", () => {
    expect(() => signLink("unsub", "a|b", NOW)).toThrow();
    expect(() => signLink("unsub", "", NOW)).toThrow();
    expect(() => signLink("un|sub", "q1", NOW)).toThrow();
    expect(() => signLink("unsub", "q1", 1.5)).toThrow();
  });
});

describe("env helpers (PD-13)", () => {
  it("linkSecret: dev default outside production, throws in production when unset", () => {
    expect(linkSecret().length).toBeGreaterThanOrEqual(32);
    process.env.CDS_ENV = "production";
    expect(() => linkSecret()).toThrow(/CDS_LINK_SECRET/);
    process.env.CDS_LINK_SECRET = "short";
    expect(() => linkSecret()).toThrow(/CDS_LINK_SECRET/);
    process.env.CDS_LINK_SECRET = "s".repeat(32);
    expect(linkSecret()).toBe("s".repeat(32));
  });

  it("platformUrl joins the base and a path; production throws when unset", () => {
    process.env.CDS_PLATFORM_URL = "https://cds.needtobeedgy.com";
    expect(platformUrl("/start/q/x")).toBe(
      "https://cds.needtobeedgy.com/start/q/x",
    );
    process.env.CDS_PLATFORM_URL = "https://cds.needtobeedgy.com/";
    expect(platformUrl("/a")).toBe("https://cds.needtobeedgy.com/a");
    expect(() => platformUrl("//evil.com")).toThrow();
    expect(() => platformUrl("no-slash")).toThrow();
    delete process.env.CDS_PLATFORM_URL;
    expect(platformUrl("/a")).toBe("http://localhost:3000/a");
    process.env.CDS_ENV = "production";
    expect(() => platformUrl("/a")).toThrow(/CDS_PLATFORM_URL/);
    process.env.CDS_PLATFORM_URL = "javascript:alert(1)";
    expect(() => platformUrl("/a")).toThrow(/CDS_PLATFORM_URL/);
  });

  it("mailDomain, supportEmail and postalAddress fall back to stand-ins", () => {
    expect(mailDomain()).toBe("send.cds.needtobeedgy.com");
    expect(supportEmail()).toBeNull();
    expect(postalAddress()).toBe("DRAFT: address pending");
    process.env.CDS_MAIL_DOMAIN = "send.connectionsdesignstudios.com";
    process.env.CDS_SUPPORT_EMAIL = "help@connectionsdesignstudios.com";
    process.env.CDS_POSTAL_ADDRESS = "1 Main St, Austin TX";
    expect(mailDomain()).toBe("send.connectionsdesignstudios.com");
    expect(supportEmail()).toBe("help@connectionsdesignstudios.com");
    expect(postalAddress()).toBe("1 Main St, Austin TX");
  });
});

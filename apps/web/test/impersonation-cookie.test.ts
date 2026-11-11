// STAFF-06, P13-P4: the impersonation cookie is HMAC-signed, bound to the staff token, expires.
import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  impersonationCookieName,
  signImpersonation,
  verifyImpersonation,
  type ImpersonationCookiePayload,
} from "../lib/impersonation-cookie";

const SECRET = "s".repeat(40);
const TOKEN = "staff-token-abc";
const NOW = new Date("2026-10-15T12:00:00.000Z");
const PAYLOAD: ImpersonationCookiePayload = {
  org: "abcdefghij12345",
  view: "admin",
  staff: "staffuser123456",
  startId: "startrow1234567",
  exp: NOW.getTime() + 60 * 60_000,
};

/** A validly signed value for an arbitrary JSON body (bypasses sign-side validation). */
function forge(json: string, token = TOKEN, secret = SECRET): string {
  const key = createHmac("sha256", secret)
    .update("cds.impersonation.v1")
    .digest();
  const th = createHash("sha256").update(token).digest("hex");
  const mac = createHmac("sha256", key)
    .update(`impersonation.v1|${json}|${th}`)
    .digest("base64url");
  return `v1.${Buffer.from(json).toString("base64url")}.${mac}`;
}

function flip(s: string, i: number): string {
  const c = s[i] === "A" ? "B" : "A";
  return s.slice(0, i) + c + s.slice(i + 1);
}

describe("signImpersonation / verifyImpersonation (P13-P4)", () => {
  it("round-trips before exp for both views", () => {
    for (const view of ["admin", "owner"] as const) {
      const v = signImpersonation({ ...PAYLOAD, view }, TOKEN, SECRET);
      expect(v).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
      expect(v.length).toBeLessThanOrEqual(512);
      expect(verifyImpersonation(v, TOKEN, SECRET, NOW)).toEqual({
        ...PAYLOAD,
        view,
      });
    }
  });

  it("refuses another staff token, another secret or no token", () => {
    const v = signImpersonation(PAYLOAD, TOKEN, SECRET);
    expect(verifyImpersonation(v, "other-token", SECRET, NOW)).toBeNull();
    expect(verifyImpersonation(v, TOKEN, "z".repeat(40), NOW)).toBeNull();
    expect(verifyImpersonation(v, "", SECRET, NOW)).toBeNull();
    expect(verifyImpersonation(v, undefined, SECRET, NOW)).toBeNull();
    expect(verifyImpersonation(v, TOKEN, "", NOW)).toBeNull();
  });

  it("refuses one flipped character in the payload or the mac", () => {
    const v = signImpersonation(PAYLOAD, TOKEN, SECRET);
    const [, body, sig] = v.split(".") as [string, string, string];
    for (let i = 0; i < body.length; i += 7) {
      expect(
        verifyImpersonation(`v1.${flip(body, i)}.${sig}`, TOKEN, SECRET, NOW),
      ).toBeNull();
    }
    for (let i = 0; i < sig.length; i += 5) {
      expect(
        verifyImpersonation(`v1.${body}.${flip(sig, i)}`, TOKEN, SECRET, NOW),
      ).toBeNull();
    }
  });

  it("refuses at or after exp", () => {
    const v = signImpersonation(PAYLOAD, TOKEN, SECRET);
    expect(
      verifyImpersonation(v, TOKEN, SECRET, new Date(PAYLOAD.exp)),
    ).toBeNull();
    expect(
      verifyImpersonation(v, TOKEN, SECRET, new Date(PAYLOAD.exp + 1)),
    ).toBeNull();
    expect(
      verifyImpersonation(v, TOKEN, SECRET, new Date(PAYLOAD.exp - 1)),
    ).not.toBeNull();
  });

  it("refuses oversized or malformed values", () => {
    for (const v of [
      undefined,
      "",
      "v1",
      "v1..",
      "v2.e30." + "A".repeat(43),
      "v1.e30.short",
      "v1.e30." + "A".repeat(43) + ".x",
      "v1." + "A".repeat(600) + "." + "A".repeat(43),
      "x".repeat(513),
    ]) {
      expect(verifyImpersonation(v, TOKEN, SECRET, NOW)).toBeNull();
    }
  });

  it("refuses a validly signed payload with bad fields", () => {
    const base = { ...PAYLOAD } as Record<string, unknown>;
    const bad: Record<string, unknown>[] = [
      { ...base, org: "../x" },
      { ...base, org: "ABCDEFGHIJ12345" },
      { ...base, view: "editor" },
      { ...base, staff: "" },
      { ...base, startId: "short" },
      { ...base, exp: "never" },
      { ...base, extra: 1 },
    ];
    for (const p of bad) {
      expect(
        verifyImpersonation(forge(JSON.stringify(p)), TOKEN, SECRET, NOW),
      ).toBeNull();
    }
    expect(
      verifyImpersonation(forge("not json"), TOKEN, SECRET, NOW),
    ).toBeNull();
    // The forge helper itself matches the real signature scheme.
    expect(
      verifyImpersonation(forge(JSON.stringify(PAYLOAD)), TOKEN, SECRET, NOW),
    ).toEqual(PAYLOAD);
  });

  it("refuses to sign a bad payload, without a token or without a secret", () => {
    expect(() =>
      signImpersonation({ ...PAYLOAD, org: "../x" }, TOKEN, SECRET),
    ).toThrow();
    expect(() => signImpersonation(PAYLOAD, "", SECRET)).toThrow();
    expect(() => signImpersonation(PAYLOAD, TOKEN, "")).toThrow();
  });

  it("names the cookie __Host-cds_imp in production, cds_imp otherwise", () => {
    expect(impersonationCookieName("production")).toBe("__Host-cds_imp");
    expect(impersonationCookieName("development")).toBe("cds_imp");
    expect(impersonationCookieName(undefined)).toBe("cds_imp");
  });
});

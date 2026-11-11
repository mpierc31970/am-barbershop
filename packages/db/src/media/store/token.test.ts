// Media tokens (07-09, CONT-33, T-07-09-04).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MEDIA_TOKEN_BUCKET_S,
  MEDIA_TOKEN_TTL_S,
  signMediaToken,
  verifyMediaToken,
  type MediaTokenRef,
} from "./token";

const KEYS = ["CDS_ENV", "CDS_MEDIA_TOKEN_SECRET"];
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const REF: MediaTokenRef = {
  orgId: "orga",
  assetId: "abcdefghijklmno",
  variant: "w960",
};
const NOW = 1_789_998_000;
const EXP = 1_790_000_000;

describe("signMediaToken / verifyMediaToken", () => {
  it("pins the HMAC over the canonical string", () => {
    process.env.CDS_MEDIA_TOKEN_SECRET = "k".repeat(32);
    // HMAC-SHA256("k" x 32, "media.v1|orga|abcdefghijklmno|w960|1790000000"), base64url
    expect(signMediaToken({ ...REF, exp: EXP })).toBe(
      "CPvo2VLDV5Z3ZmoREVNpOpN4-bxYfpC6mXpcyegPCDA",
    );
  });

  it("verifies only the exact org + asset + variant + exp inside the window", () => {
    const t = signMediaToken({ ...REF, exp: EXP });
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verifyMediaToken(REF, String(EXP), t, NOW)).toBe(true);
    expect(
      verifyMediaToken({ ...REF, orgId: "orgb" }, String(EXP), t, NOW),
    ).toBe(false);
    expect(
      verifyMediaToken(
        { ...REF, assetId: "abcdefghijklmnp" },
        String(EXP),
        t,
        NOW,
      ),
    ).toBe(false);
    expect(
      verifyMediaToken({ ...REF, variant: "w480" }, String(EXP), t, NOW),
    ).toBe(false);
    expect(verifyMediaToken(REF, String(EXP + 1), t, NOW)).toBe(false);
    // expired, and exactly at exp
    expect(verifyMediaToken(REF, String(EXP), t, EXP)).toBe(false);
    expect(verifyMediaToken(REF, String(EXP), t, EXP + 1)).toBe(false);
  });

  it("refuses far-future tokens", () => {
    const far = NOW + MEDIA_TOKEN_TTL_S + MEDIA_TOKEN_BUCKET_S + 1;
    const t = signMediaToken({ ...REF, exp: far });
    expect(verifyMediaToken(REF, String(far), t, NOW)).toBe(false);
    const edge = NOW + MEDIA_TOKEN_TTL_S + MEDIA_TOKEN_BUCKET_S;
    expect(
      verifyMediaToken(
        REF,
        String(edge),
        signMediaToken({ ...REF, exp: edge }),
        NOW,
      ),
    ).toBe(true);
  });

  it("is false (never a throw) on malformed input", () => {
    const t = signMediaToken({ ...REF, exp: EXP });
    const badE = ["", "abc", "-1", "1.5", "1234567890123", " 1790000000"];
    for (const e of badE)
      expect(verifyMediaToken(REF, e, t, NOW), e).toBe(false);
    const flipped = t.slice(0, 42) + (t[42] === "A" ? "Q" : "A");
    const badT = ["", t.slice(1), `${t}A`, t.replace(/.$/, "+"), flipped];
    for (const x of badT)
      expect(verifyMediaToken(REF, String(EXP), x, NOW), x).toBe(false);
    expect(verifyMediaToken(REF, null, t, NOW)).toBe(false);
    expect(verifyMediaToken(REF, String(EXP), null, NOW)).toBe(false);
  });

  it("fails closed in production without a long enough secret", () => {
    process.env.CDS_ENV = "production";
    expect(() => signMediaToken({ ...REF, exp: EXP })).toThrow(
      /CDS_MEDIA_TOKEN_SECRET must be set in production/,
    );
    expect(() =>
      verifyMediaToken(REF, String(EXP), "A".repeat(43), NOW),
    ).toThrow(/CDS_MEDIA_TOKEN_SECRET/);
    process.env.CDS_MEDIA_TOKEN_SECRET = "short";
    expect(() => signMediaToken({ ...REF, exp: EXP })).toThrow(/at least 32/);
    process.env.CDS_MEDIA_TOKEN_SECRET = "x".repeat(32);
    expect(signMediaToken({ ...REF, exp: EXP })).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("uses a fixed dev secret outside production", () => {
    const a = signMediaToken({ ...REF, exp: EXP });
    process.env.CDS_MEDIA_TOKEN_SECRET = "k".repeat(32);
    expect(signMediaToken({ ...REF, exp: EXP })).not.toBe(a);
  });
});

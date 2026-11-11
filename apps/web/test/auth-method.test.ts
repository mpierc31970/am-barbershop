// Review CR-C01: the auth-method evidence cookie is HMAC-signed and bound to the session token.
import { describe, expect, it } from "vitest";
import { signAuthMethod, verifyAuthMethod } from "../lib/auth-method";

const SECRET = "s".repeat(40);

describe("signAuthMethod / verifyAuthMethod (CR-C01)", () => {
  it("round-trips both methods for the same token", () => {
    for (const m of ["otp", "password"] as const) {
      const v = signAuthMethod(m, "tok", SECRET);
      expect(v).toMatch(new RegExp(`^${m}\\.[A-Za-z0-9_-]{43}$`));
      expect(verifyAuthMethod(v, "tok", SECRET)).toBe(m);
    }
  });

  it("refuses plain, malformed or oversized values", () => {
    for (const v of [
      undefined,
      "",
      "otp",
      "password",
      "otp.",
      "otp.short",
      "sso." + "A".repeat(43),
      "otp." + "A".repeat(43),
      "x".repeat(200),
    ]) {
      expect(verifyAuthMethod(v, "tok", SECRET)).toBe("unknown");
    }
  });

  it("refuses a swapped method, another token or another secret", () => {
    const v = signAuthMethod("password", "tok", SECRET);
    const sig = v.split(".")[1];
    expect(verifyAuthMethod(`otp.${sig}`, "tok", SECRET)).toBe("unknown");
    expect(verifyAuthMethod(v, "other", SECRET)).toBe("unknown");
    expect(verifyAuthMethod(v, "", SECRET)).toBe("unknown");
    expect(verifyAuthMethod(v, undefined, SECRET)).toBe("unknown");
    expect(verifyAuthMethod(v, "tok", "z".repeat(40))).toBe("unknown");
  });

  it("refuses to sign without a token or with a bad method", () => {
    expect(() => signAuthMethod("otp", "", SECRET)).toThrow();
    expect(() =>
      signAuthMethod("sso" as unknown as "otp", "tok", SECRET),
    ).toThrow();
  });
});

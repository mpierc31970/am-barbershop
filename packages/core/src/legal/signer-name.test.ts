// WR-B04: one typed-signature normaliser for the hub and the server.
import { describe, expect, it } from "vitest";
import { normalizeSignerName, signerNameValid } from "./signer-name";

describe("normalizeSignerName", () => {
  it("collapses whitespace and turns control characters into spaces", () => {
    expect(normalizeSignerName("Ana\u0007  Rivera ")).toBe("Ana Rivera");
    expect(normalizeSignerName("  Ana\t\nRivera")).toBe("Ana Rivera");
  });

  it("turns format characters (zero-width, bidi, soft hyphen, tags) into spaces", () => {
    expect(normalizeSignerName("Jo\u200Bhn")).toBe("Jo hn");
    expect(normalizeSignerName("A\u00AD")).toBe("A");
    expect(normalizeSignerName("Ana\u202ERivera")).toBe("Ana Rivera");
    expect(normalizeSignerName("Ana\u{E0041}Rivera")).toBe("Ana Rivera");
    expect(normalizeSignerName("Ana\u2028Rivera")).toBe("Ana Rivera");
  });

  it("applies NFC", () => {
    expect(normalizeSignerName("Jose\u0301")).toBe("José");
  });
});

describe("signerNameValid", () => {
  it("needs 2 to 120 code points after normalising", () => {
    expect(signerNameValid(" A ")).toBe(false);
    expect(signerNameValid("A\u00AD")).toBe(false);
    expect(signerNameValid("Al")).toBe(true);
    expect(signerNameValid("a".repeat(120))).toBe(true);
    expect(signerNameValid("a".repeat(121))).toBe(false);
    expect(signerNameValid("\u0000\u0001")).toBe(false);
  });
});

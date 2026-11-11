// 12-07 Task 1: 15-minute signed support-file links (choice 5).
import { describe, expect, it } from "vitest";
import { signDownloadLink } from "../downloads/links";
import {
  SUPPORT_FILE_LINK_MS,
  signSupportFileLink,
  supportFileLinkPath,
  supportFileLinkState,
  verifySupportFileLink,
} from "./links";

const ID = "abcdefghij12345";
const NOW = Date.UTC(2026, 9, 12, 12, 0, 0);

describe("support-file links", () => {
  it("lasts 15 minutes", () => {
    expect(SUPPORT_FILE_LINK_MS).toBe(15 * 60 * 1000);
  });

  it("verifies within 15 minutes and not at 15 min + 1 ms", () => {
    const exp = NOW + SUPPORT_FILE_LINK_MS;
    const sig = signSupportFileLink(ID, exp);
    expect(verifySupportFileLink(ID, exp, sig, NOW)).toBe(true);
    expect(verifySupportFileLink(ID, String(exp), sig, exp - 1)).toBe(true);
    expect(verifySupportFileLink(ID, exp, sig, exp + 1)).toBe(false);
    expect(supportFileLinkState(ID, exp, sig, exp + 1)).toBe("expired");
    expect(supportFileLinkState(ID, exp, sig, NOW)).toBe("valid");
  });

  it("refuses a tampered signature, id or expiry", () => {
    const exp = NOW + SUPPORT_FILE_LINK_MS;
    const sig = signSupportFileLink(ID, exp);
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect(verifySupportFileLink(ID, exp, flipped, NOW)).toBe(false);
    expect(supportFileLinkState(ID, exp, flipped, NOW)).toBe("invalid");
    expect(verifySupportFileLink("abcdefghij12346", exp, sig, NOW)).toBe(false);
    expect(verifySupportFileLink(ID, exp + 1, sig, NOW)).toBe(false);
    expect(verifySupportFileLink(ID, "x", sig, NOW)).toBe(false);
    expect(verifySupportFileLink(ID, exp, undefined, NOW)).toBe(false);
  });

  it("never accepts a data-download. MAC for the same id and expiry", () => {
    const exp = NOW + SUPPORT_FILE_LINK_MS;
    const other = signDownloadLink(ID, exp);
    expect(verifySupportFileLink(ID, exp, other, NOW)).toBe(false);
    expect(supportFileLinkState(ID, exp, other, NOW)).toBe("invalid");
  });

  it("builds the route path", () => {
    const exp = NOW + SUPPORT_FILE_LINK_MS;
    const path = supportFileLinkPath(ID, exp);
    expect(path).toBe(
      `/hub/api/support-file/${ID}?exp=${exp}&sig=${signSupportFileLink(ID, exp)}`,
    );
  });

  it("refuses to sign a bad id", () => {
    expect(() => signSupportFileLink("../x", NOW)).toThrow();
  });
});

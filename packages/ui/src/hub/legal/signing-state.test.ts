// 09-04 Task 1: pure signing helpers (09-UI-SPEC "Copywriting Contract", "SignaturePanel").
import {
  normalizeSignerName,
  signerNameValid,
} from "@cds/core/legal/signer-name";
import { describe, expect, it } from "vitest";
import {
  SIGNING_COPY,
  normalizeTypedName,
  progressLabel,
  signingReason,
  signingStatement,
  typedNameValid,
} from "./signing-state";

describe("signingReason", () => {
  it("names both missing boxes and the name", () => {
    expect(signingReason(3, false)).toBe(
      "Tick 3 more boxes and type your name to sign.",
    );
  });
  it("uses the singular for one box", () => {
    expect(signingReason(1, true)).toBe("Tick 1 more box to sign.");
    expect(signingReason(1, false)).toBe(
      "Tick 1 more box and type your name to sign.",
    );
  });
  it("asks only for the name when every box is ticked", () => {
    expect(signingReason(0, false)).toBe("Type your name to sign.");
  });
  it("is null when complete", () => {
    expect(signingReason(0, true)).toBeNull();
  });
  it("uses the plural for several boxes with a name", () => {
    expect(signingReason(4, true)).toBe("Tick 4 more boxes to sign.");
  });
});

describe("typed name", () => {
  it("normalises whitespace and strips control characters", () => {
    expect(normalizeTypedName("Ana\u0007  Rivera ")).toBe("Ana Rivera");
    expect(normalizeTypedName("  Ana\t\nRivera")).toBe("Ana Rivera");
  });
  it("needs 2 to 120 characters after normalising", () => {
    expect(typedNameValid(" A ")).toBe(false);
    expect(typedNameValid("Ana Rivera")).toBe(true);
    expect(typedNameValid("Al")).toBe(true);
    expect(typedNameValid("a".repeat(120))).toBe(true);
    expect(typedNameValid("a".repeat(121))).toBe(false);
    expect(typedNameValid("\u0000\u0001")).toBe(false);
  });
  it("WR-B04: is the server's normaliser (format chars to spaces, NFC)", () => {
    for (const raw of [
      "Jo\u200Bhn",
      "A\u00AD",
      "Jose\u0301",
      " Ana  Rivera ",
    ]) {
      expect(normalizeTypedName(raw)).toBe(normalizeSignerName(raw));
      expect(typedNameValid(raw)).toBe(signerNameValid(raw));
    }
    expect(normalizeTypedName("Jo\u200Bhn")).toBe("Jo hn");
    expect(typedNameValid("A\u00AD")).toBe(false);
  });
});

describe("progressLabel", () => {
  it("reads N of M accepted", () => {
    expect(progressLabel(2, 5)).toBe("2 of 5 accepted");
    expect(progressLabel(0, 2)).toBe("0 of 2 accepted");
  });
});

describe("signingStatement", () => {
  it("starts with the name once typed", () => {
    expect(
      signingStatement({
        name: "Ana Rivera",
        onBehalfOf: "Rivera Wellness LLC",
        dateLabel: "8 Oct 2026",
      }),
    ).toBe(
      "Ana Rivera, you're signing for Rivera Wellness LLC on 8 Oct 2026. The time and your IP address are recorded with your signature.",
    );
  });
  it("starts with You're signing for without a valid name", () => {
    expect(
      signingStatement({
        name: "  ",
        onBehalfOf: "Rivera Wellness LLC",
        dateLabel: "8 Oct 2026",
      }),
    ).toBe(
      "You're signing for Rivera Wellness LLC on 8 Oct 2026. The time and your IP address are recorded with your signature.",
    );
  });
});

describe("SIGNING_COPY", () => {
  it("carries the UI-SPEC strings verbatim", () => {
    expect(SIGNING_COPY.policyCheckbox("Terms of Service")).toBe(
      "I have read and agree to the Terms of Service.",
    );
    expect(SIGNING_COPY.consentText).toBe(
      "I agree to sign electronically and to receive these agreements and notices electronically. I can download a copy now and ask for a paper copy at any time.",
    );
    expect(SIGNING_COPY.nameLabel).toBe("Your full legal name");
    expect(SIGNING_COPY.nameHelper).toBe(
      "Type your name as you'd sign it on paper. Typing it here is your signature.",
    );
    expect(SIGNING_COPY.nameError).toBe(
      "Type your full name (at least 2 characters).",
    );
    expect(SIGNING_COPY.readFullText).toBe("Read the full text");
    expect(SIGNING_COPY.hideFullText).toBe("Hide the full text");
    expect(SIGNING_COPY.openInNewTab).toBe("Open in a new tab");
    expect(SIGNING_COPY.sign).toBe("Sign and accept");
    expect(SIGNING_COPY.signing).toBe("Signing…");
  });
});

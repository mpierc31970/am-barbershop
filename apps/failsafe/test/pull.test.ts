import { describe, expect, it } from "vitest";
import {
  ackMessage,
  pullMessage,
  signAck,
  replayGuard,
  signPull,
  verifyAck,
  verifyPull,
} from "../src/pull.ts";
import { hmacHex } from "../src/crypto.ts";

const SECRET = "test-pull-secret-0123456789";
const NOW = new Date("2026-10-13T12:00:00.000Z");
const SINCE = "2026-10-01T00:00:00.000Z";
const MIN = 60_000;

describe("signed pull", () => {
  it("signs the documented message strings", () => {
    expect(pullMessage(SINCE, 123)).toBe(`pull|${SINCE}|123`);
    expect(ackMessage(["a", "b"], 123)).toBe("ack|a,b|123");
    expect(signPull(SECRET, SINCE, 123)).toBe(
      hmacHex(SECRET, `pull|${SINCE}|123`),
    );
    expect(signPull(SECRET, SINCE, 123)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("accepts a fresh correct signature", () => {
    const ts = NOW.getTime() - 30_000;
    const sig = signPull(SECRET, SINCE, ts);
    expect(
      verifyPull({
        secret: SECRET,
        since: SINCE,
        ts: String(ts),
        sig,
        now: NOW,
      }),
    ).toBe(true);
  });

  it("refuses a wrong signature", () => {
    const ts = NOW.getTime();
    const sig = signPull("other-secret", SINCE, ts);
    expect(
      verifyPull({
        secret: SECRET,
        since: SINCE,
        ts: String(ts),
        sig,
        now: NOW,
      }),
    ).toBe(false);
    expect(
      verifyPull({
        secret: SECRET,
        since: "2026-09-01T00:00:00.000Z",
        ts: String(ts),
        sig: signPull(SECRET, SINCE, ts),
        now: NOW,
      }),
    ).toBe(false);
    expect(
      verifyPull({
        secret: SECRET,
        since: SINCE,
        ts: String(ts),
        sig: "zz",
        now: NOW,
      }),
    ).toBe(false);
  });

  it("refuses a timestamp 6 minutes old or 6 minutes ahead", () => {
    for (const ts of [NOW.getTime() - 6 * MIN, NOW.getTime() + 6 * MIN]) {
      const sig = signPull(SECRET, SINCE, ts);
      expect(
        verifyPull({
          secret: SECRET,
          since: SINCE,
          ts: String(ts),
          sig,
          now: NOW,
        }),
      ).toBe(false);
    }
  });

  it("refuses an empty or unset secret, and a malformed ts", () => {
    const ts = NOW.getTime();
    const sig = signPull("", SINCE, ts);
    expect(
      verifyPull({ secret: "", since: SINCE, ts: String(ts), sig, now: NOW }),
    ).toBe(false);
    expect(
      verifyPull({
        secret: undefined,
        since: SINCE,
        ts: String(ts),
        sig,
        now: NOW,
      }),
    ).toBe(false);
    expect(
      verifyPull({
        secret: SECRET,
        since: SINCE,
        ts: `${ts}.0`,
        sig: signPull(SECRET, SINCE, ts),
        now: NOW,
      }),
    ).toBe(false);
  });

  it("WR-B01: refuses a since that does not parse; accepts an empty one", () => {
    const ts = NOW.getTime();
    for (const [since, want] of [
      ["", true],
      ["yesterday-ish", false],
    ] as const) {
      expect(
        verifyPull({
          secret: SECRET,
          since,
          ts,
          sig: signPull(SECRET, since, ts),
          now: NOW,
        }),
      ).toBe(want);
    }
  });

  it("WR-B01: replayGuard accepts a signature once, forgets it after the window", () => {
    const first = replayGuard();
    const t = NOW.getTime();
    expect(first("a".repeat(64), t)).toBe(true);
    expect(first("a".repeat(64), t + MIN)).toBe(false);
    expect(first("b".repeat(64), t + MIN)).toBe(true);
    expect(first("a".repeat(64), t + 11 * MIN)).toBe(true);
  });

  it("verifies an ack over the id list", () => {
    const ts = NOW.getTime();
    const ids = ["abc", "def"];
    const sig = signAck(SECRET, ids, ts);
    expect(verifyAck({ secret: SECRET, ids, ts, sig, now: NOW })).toBe(true);
    expect(verifyAck({ secret: SECRET, ids: ["abc"], ts, sig, now: NOW })).toBe(
      false,
    );
  });
});

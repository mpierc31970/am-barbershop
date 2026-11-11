// CR-C01: the confirm token binds a charge to one org, one item and the previewed figures, and
// expires after 15 minutes. Anything tampered, foreign or stale reads as null.
import { describe, expect, it } from "vitest";
import {
  CHARGE_TOKEN_TTL_S,
  mintChargeToken,
  readChargeToken,
} from "./charge-token";

const NOW = new Date("2026-10-31T23:58:00.000Z");
const claims = {
  orgId: "org000000000001",
  item: "pack:media-5gb",
  basis: 1,
  todayCents: 13,
  thenCents: 500,
  at: NOW.getTime(),
};
const want = { orgId: claims.orgId, item: claims.item };

describe("charge confirm token (CR-C01)", () => {
  it("round-trips the claims with a fresh nonce each time", () => {
    const a = mintChargeToken(claims);
    const b = mintChargeToken(claims);
    expect(a).not.toBe(b);
    const read = readChargeToken(a, want, NOW);
    expect(read).toMatchObject(claims);
    expect(read?.nonce).toMatch(/^[0-9a-f-]{36}$/);
    expect(readChargeToken(b, want, NOW)?.nonce).not.toBe(read?.nonce);
  });

  it("refuses another org's or another item's token", () => {
    const t = mintChargeToken(claims);
    expect(
      readChargeToken(t, { ...want, orgId: "org000000000002" }, NOW),
    ).toBeNull();
    expect(
      readChargeToken(t, { ...want, item: "pack:media-25gb" }, NOW),
    ).toBeNull();
  });

  it("refuses a tampered figure (the signature covers every claim)", () => {
    const t = mintChargeToken(claims);
    const [payload, sig] = t.split(".") as [string, string];
    const body = JSON.parse(Buffer.from(payload, "base64url").toString());
    body.todayCents = 0;
    const forged = `${Buffer.from(JSON.stringify(body)).toString("base64url")}.${sig}`;
    expect(readChargeToken(forged, want, NOW)).toBeNull();
  });

  it("expires after 15 minutes and refuses one minted far in the future", () => {
    const t = mintChargeToken(claims);
    const late = new Date(NOW.getTime() + CHARGE_TOKEN_TTL_S * 1000 + 1);
    expect(readChargeToken(t, want, late)).toBeNull();
    const early = new Date(NOW.getTime() - 5 * 60 * 1000);
    expect(readChargeToken(t, want, early)).toBeNull();
  });

  it("refuses junk without throwing", () => {
    for (const junk of [undefined, null, 1, "", "a.b", "x".repeat(2000), {}]) {
      expect(readChargeToken(junk, want, NOW)).toBeNull();
    }
  });
});

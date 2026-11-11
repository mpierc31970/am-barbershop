// appDelivery: the app-served MediaDelivery stand-in (07-09, CONT-20).
import { describe, expect, it } from "vitest";
import { InvalidInput } from "@cds/core";
import type { DeliveryAssetRef, PublicMediaVariant } from "../ports";
import {
  APP_MEDIA_PATH,
  appDelivery,
  createAppDelivery,
  nearestMediaWidth,
} from "./app-delivery";
import { MEDIA_TOKEN_BUCKET_S, verifyMediaToken } from "./token";

const IMG: DeliveryAssetRef = {
  id: "abcdefghijklmno",
  orgId: "orga",
  kind: "image",
};
const NOW_MS = Date.UTC(2026, 9, 5, 4, 7, 13);

describe("nearestMediaWidth", () => {
  it("snaps up to the next pre-generated width", () => {
    expect(nearestMediaWidth(1)).toBe(480);
    expect(nearestMediaWidth(480)).toBe(480);
    expect(nearestMediaWidth(481)).toBe(960);
    expect(nearestMediaWidth(1600)).toBe(1600);
    expect(nearestMediaWidth(5000)).toBe(2560);
    for (const bad of [0, -1, Number.NaN, Infinity]) {
      expect(() => nearestMediaWidth(bad), String(bad)).toThrow(InvalidInput);
    }
  });
});

describe("appDelivery.urlFor", () => {
  it("is host-relative under /_media", () => {
    expect(APP_MEDIA_PATH).toBe("/_media");
    expect(appDelivery.name).toBe("app");
    expect(appDelivery.urlFor(IMG, "w1600")).toBe(
      "/_media/abcdefghijklmno/w1600",
    );
  });

  it("adds ?w= only when smaller than the path variant, and only on w*", () => {
    expect(appDelivery.urlFor(IMG, "w1600", { width: 700 })).toBe(
      "/_media/abcdefghijklmno/w1600?w=960",
    );
    expect(appDelivery.urlFor(IMG, "w1600", { width: 2000 })).toBe(
      "/_media/abcdefghijklmno/w1600",
    );
    expect(appDelivery.urlFor(IMG, "w1600", { width: 1600 })).toBe(
      "/_media/abcdefghijklmno/w1600",
    );
    expect(appDelivery.urlFor(IMG, "thumb", { width: 100 })).toBe(
      "/_media/abcdefghijklmno/thumb",
    );
  });

  it("signs protected URLs with a bucketed exp", () => {
    const d = createAppDelivery({ now: () => NOW_MS });
    const url = d.urlFor(IMG, "w960", {
      width: 300,
      protected: { pageId: "page1" },
    });
    const u = new URL(url, "https://a.example.com");
    expect(u.pathname).toBe("/_media/abcdefghijklmno/w960");
    expect([...u.searchParams.keys()]).toEqual(["w", "e", "t"]);
    expect(u.searchParams.get("w")).toBe("480");
    const e = Number(u.searchParams.get("e"));
    const nowSec = Math.floor(NOW_MS / 1000);
    expect(e % MEDIA_TOKEN_BUCKET_S).toBe(0);
    expect(e - nowSec).toBeGreaterThanOrEqual(3600);
    expect(e - nowSec).toBeLessThanOrEqual(4200);
    expect(
      verifyMediaToken(
        { orgId: "orga", assetId: IMG.id, variant: "w960" },
        u.searchParams.get("e"),
        u.searchParams.get("t"),
        nowSec,
      ),
    ).toBe(true);
    // stable within the bucket
    const later = createAppDelivery({ now: () => NOW_MS + 60_000 });
    expect(
      later.urlFor(IMG, "w960", { width: 300, protected: { pageId: "page1" } }),
    ).toBe(url);
  });

  it("refuses disallowed variants, bad kinds and unsafe ids", () => {
    const bad: [DeliveryAssetRef, string][] = [
      [IMG, "video.mp4"],
      [{ ...IMG, kind: "audio" }, "w960"],
      [{ ...IMG, kind: "file" as "image" }, "w960"],
      [{ ...IMG, id: "../x" }, "w960"],
      [{ ...IMG, id: "a/b" }, "w960"],
      [{ ...IMG, orgId: "../o" }, "w960"],
    ];
    for (const [ref, v] of bad) {
      expect(
        () => appDelivery.urlFor(ref, v as PublicMediaVariant),
        `${ref.kind}/${ref.id}/${v}`,
      ).toThrow(InvalidInput);
    }
  });

  it("purge resolves and deliveryBytes is null (no CDN)", async () => {
    await expect(appDelivery.purge(["x"])).resolves.toBeUndefined();
    await expect(
      appDelivery.deliveryBytes("orga", "2026-10"),
    ).resolves.toBeNull();
  });
});

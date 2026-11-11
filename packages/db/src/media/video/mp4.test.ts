// sniffMp4 / readHead (07-13 choice 4) and the kept-original key (07-13, D220).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPublicMediaKey, tenantMediaKey } from "../../storage/keys";
import { readHead, sniffMp4 } from "./mp4";

function box(brand: string, size = 0x18): Uint8Array {
  const out = new Uint8Array(32);
  out.set(
    [(size >>> 24) & 255, (size >>> 16) & 255, (size >>> 8) & 255, size & 255],
    0,
  );
  out.set(new TextEncoder().encode("ftyp"), 4);
  out.set(new TextEncoder().encode(brand), 8);
  return out;
}

describe("sniffMp4", () => {
  it("accepts ISO-BMFF ftyp brands", () => {
    for (const b of ["isom", "mp42", "M4V ", "3gp5", "qt  "]) {
      expect(sniffMp4(box(b)), b).toBe(true);
    }
    expect(sniffMp4(box("isom", 1))).toBe(true); // 64-bit size marker
  });

  it("refuses everything else", () => {
    expect(sniffMp4(box("isom", 4))).toBe(false);
    const shifted = new Uint8Array(32);
    shifted.set(new TextEncoder().encode("xxxxxftypisom"), 0);
    expect(sniffMp4(shifted)).toBe(false);
    expect(
      sniffMp4(new TextEncoder().encode("RIFF\x00\x00\x00\x00AVI LIST")),
    ).toBe(false);
    expect(
      sniffMp4(
        new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8]),
      ),
    ).toBe(false);
    expect(
      sniffMp4(
        new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
        ]),
      ),
    ).toBe(false);
    expect(sniffMp4(new Uint8Array(0))).toBe(false);
    expect(sniffMp4(box("isom").subarray(0, 7))).toBe(false);
    const bin = box("isom");
    bin[9] = 0x01; // non-printable brand
    expect(sniffMp4(bin)).toBe(false);
  });

  it("readHead reads only the first bytes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cds-mp4-"));
    try {
      const p = join(dir, "a.mp4");
      const body = new Uint8Array(1000);
      body.set(box("isom"), 0);
      writeFileSync(p, body);
      const head = await readHead(p);
      expect(head.length).toBe(64);
      expect(sniffMp4(head)).toBe(true);
      writeFileSync(p, new Uint8Array(5));
      expect((await readHead(p)).length).toBe(5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("original.mp4 key", () => {
  it("is a private media name and never a public key", () => {
    const k = tenantMediaKey(
      "orga12345678901",
      "asset1234567890",
      "original.mp4",
    );
    expect(k.endsWith("/original.mp4")).toBe(true);
    expect(isPublicMediaKey(k)).toBe(false);
  });
});

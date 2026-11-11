// 14-07 (P14-P11, DOM-10): hand-written QR encoder, checked against published ISO/IEC 18004 vectors.
import { describe, expect, it } from "vitest";
import { encodeQr, qrFormatBits, qrReedSolomon, qrVersionBits } from "./encode";

const bits = (n: number, len: number): string =>
  n.toString(2).padStart(len, "0");

describe("qrReedSolomon", () => {
  it("matches the published HELLO WORLD 1-M EC codewords", () => {
    const data = [
      32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17,
    ];
    expect(qrReedSolomon(data, 10)).toEqual([
      196, 35, 39, 119, 235, 215, 231, 226, 93, 23,
    ]);
  });
});

describe("qrFormatBits", () => {
  it("equals the standard table for level M, masks 0-7", () => {
    const table = [
      "101010000010010",
      "101000100100101",
      "101111001111100",
      "101101101001011",
      "100010111111001",
      "100000011001110",
      "100111110010111",
      "100101010100000",
    ];
    for (let mask = 0; mask < 8; mask++)
      expect(bits(qrFormatBits(mask), 15)).toBe(table[mask]);
  });
});

describe("qrVersionBits", () => {
  it("encodes version 7", () => {
    expect(bits(qrVersionBits(7), 18)).toBe("000111110010010100");
  });
});

function expectFinder(m: boolean[][], top: number, left: number): void {
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
      expect(
        m[top + r]![left + c],
        `finder at ${top},${left} cell ${r},${c}`,
      ).toBe(ring !== 2);
    }
  }
}

describe("encodeQr structure", () => {
  for (const len of [10, 60, 120, 200]) {
    it(`is a well-formed symbol for ${len} bytes`, () => {
      const q = encodeQr("a".repeat(len));
      const v = q.version;
      expect(q.size).toBe(17 + 4 * v);
      expect(q.modules).toHaveLength(q.size);
      for (const row of q.modules) expect(row).toHaveLength(q.size);
      expectFinder(q.modules, 0, 0);
      expectFinder(q.modules, 0, q.size - 7);
      expectFinder(q.modules, q.size - 7, 0);
      for (let i = 8; i < q.size - 8; i++) {
        expect(q.modules[6]![i]).toBe(i % 2 === 0);
        expect(q.modules[i]![6]).toBe(i % 2 === 0);
      }
      expect(q.modules[4 * v + 9]![8]).toBe(true);
      // Separators are light.
      for (let i = 0; i < 8; i++) {
        expect(q.modules[7]![i]).toBe(false);
        expect(q.modules[i]![7]).toBe(false);
      }
    });
  }

  it("writes format info that decodes to level M in both copies", () => {
    const q = encodeQr("https://review.example.test/abc");
    const m = q.modules;
    // Copy 1 around the top-left finder, bit 14 first (ISO placement).
    const a: number[] = [];
    for (let i = 0; i <= 5; i++) a.push(m[8]![i] ? 1 : 0);
    a.push(m[8]![7] ? 1 : 0, m[8]![8] ? 1 : 0, m[7]![8] ? 1 : 0);
    for (let i = 5; i >= 0; i--) a.push(m[i]![8] ? 1 : 0);
    const word = parseInt(a.join(""), 2);
    const masks = [0, 1, 2, 3, 4, 5, 6, 7].filter(
      (k) => qrFormatBits(k) === word,
    );
    expect(masks).toHaveLength(1);
    // Copy 2: bottom-left column then top-right row.
    const b: number[] = [];
    for (let i = 0; i < 7; i++) b.push(m[q.size - 1 - i]![8] ? 1 : 0);
    for (let i = 0; i < 8; i++) b.push(m[8]![q.size - 8 + i] ? 1 : 0);
    expect(parseInt(b.join(""), 2)).toBe(word);
  });

  it("writes version info for v7+", () => {
    const q = encodeQr("x".repeat(130));
    expect(q.version).toBeGreaterThanOrEqual(7);
    const want = qrVersionBits(q.version);
    for (let i = 0; i < 18; i++) {
      const bit = ((want >> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = (i % 3) + q.size - 11;
      expect(q.modules[a]![b]).toBe(bit);
      expect(q.modules[b]![a]).toBe(bit);
    }
  });

  it("is deterministic", () => {
    expect(encodeQr("same")).toEqual(encodeQr("same"));
  });
});

describe("encodeQr version selection (byte mode, level M)", () => {
  it.each([
    [14, 1],
    [84, 5],
    [85, 6],
    [100, 6],
    [213, 10],
  ])("%i bytes -> v%i", (len, v) => {
    expect(encodeQr("a".repeat(len)).version).toBe(v);
  });

  it("refuses text past v10-M capacity", () => {
    expect(() => encodeQr("a".repeat(214))).toThrow(RangeError);
  });

  it("counts UTF-8 bytes, not characters", () => {
    // 107 two-byte chars = 214 bytes.
    expect(() => encodeQr("é".repeat(107))).toThrow(RangeError);
    expect(encodeQr("é".repeat(7)).version).toBe(1);
  });
});

// Independent reader: rebuild the function-pattern map from the spec, unmask with the mask named by
// the format bits, read the zigzag, de-interleave, check every block's EC and decode the bytes.
const EC_M: Record<number, [number, number]> = {
  1: [10, 1],
  2: [16, 1],
  3: [26, 1],
  4: [18, 2],
  5: [24, 2],
  6: [16, 4],
  7: [18, 4],
  8: [22, 4],
  9: [22, 5],
  10: [26, 5],
};
const ALIGN: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};
const MASKS: ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function readBack(q: ReturnType<typeof encodeQr>): string {
  const n = q.size;
  const v = q.version;
  const fn = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const mark = (r: number, c: number): void => {
    if (r >= 0 && c >= 0 && r < n && c < n) fn[r]![c] = true;
  };
  for (let i = 0; i < n; i++) {
    mark(6, i);
    mark(i, 6);
  }
  for (const [r0, c0] of [
    [0, 0],
    [0, n - 8],
    [n - 8, 0],
  ] as const)
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++) mark(r0 + r, c0 + c);
  for (let i = 0; i < 9; i++) {
    mark(8, i);
    mark(i, 8);
  }
  for (let i = 0; i < 8; i++) {
    mark(8, n - 1 - i);
    mark(n - 1 - i, 8);
  }
  const al = ALIGN[v]!;
  for (const r of al)
    for (const c of al) {
      if ((r < 9 && c < 9) || (r < 9 && c > n - 9) || (r > n - 9 && c < 9))
        continue;
      for (let dr = -2; dr <= 2; dr++)
        for (let dc = -2; dc <= 2; dc++) mark(r + dr, c + dc);
    }
  if (v >= 7)
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < 3; j++) {
        mark(i, n - 11 + j);
        mark(n - 11 + j, i);
      }
  // Mask from format copy 1.
  const a: number[] = [];
  for (let i = 0; i <= 5; i++) a.push(q.modules[8]![i] ? 1 : 0);
  a.push(
    q.modules[8]![7] ? 1 : 0,
    q.modules[8]![8] ? 1 : 0,
    q.modules[7]![8] ? 1 : 0,
  );
  for (let i = 5; i >= 0; i--) a.push(q.modules[i]![8] ? 1 : 0);
  const word = parseInt(a.join(""), 2);
  const mask = [0, 1, 2, 3, 4, 5, 6, 7].find((k) => qrFormatBits(k) === word)!;
  const bitsOut: number[] = [];
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const up = ((right + 1) & 2) === 0;
    for (let k = 0; k < n; k++) {
      const r = up ? n - 1 - k : k;
      for (const c of [right, right - 1]) {
        if (fn[r]![c]) continue;
        bitsOut.push(q.modules[r]![c] !== MASKS[mask]!(r, c) ? 1 : 0);
      }
    }
  }
  const cw: number[] = [];
  for (let i = 0; i + 8 <= bitsOut.length; i += 8)
    cw.push(parseInt(bitsOut.slice(i, i + 8).join(""), 2));
  const [ecLen, nb] = EC_M[v]!;
  const total = cw.length;
  const shortLen = Math.floor(total / nb);
  const nShort = nb - (total % nb);
  const lens = Array.from(
    { length: nb },
    (_, i) => shortLen - ecLen + (i < nShort ? 0 : 1),
  );
  const blocks: number[][] = lens.map(() => []);
  let p = 0;
  for (let i = 0; i < Math.max(...lens); i++)
    for (let b = 0; b < nb; b++) if (i < lens[b]!) blocks[b]!.push(cw[p++]!);
  for (let b = 0; b < nb; b++) {
    const ec = Array.from({ length: ecLen }, (_, i) => cw[p + i * nb + b]!);
    expect(qrReedSolomon(blocks[b]!, ecLen)).toEqual(ec);
  }
  const data = blocks.flat();
  const bits = data.map((d) => d.toString(2).padStart(8, "0")).join("");
  expect(bits.slice(0, 4)).toBe("0100");
  const cb = v <= 9 ? 8 : 16;
  const len = parseInt(bits.slice(4, 4 + cb), 2);
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++)
    bytes[i] = parseInt(bits.slice(4 + cb + i * 8, 12 + cb + i * 8), 2);
  return new TextDecoder().decode(bytes);
}

describe("encodeQr round trip (independent reader)", () => {
  const link =
    "https://review.rivera-bakery.sites.connectionsdesignstudios.com/r/9f3Kx2LmQa7TzP0vB4nW8cY1?p=home";
  it.each([
    ["short", "hi"],
    ["review link", link],
    ["v6 multi-block", "b".repeat(100)],
    ["v7", "c".repeat(110)],
    ["v8 uneven blocks", "c".repeat(130)],
    ["v9 uneven blocks", "c".repeat(170)],
    ["v10 full", "d".repeat(213)],
    ["utf-8", "Café · Rivera ✓"],
  ])("%s", (_name, text) => {
    expect(readBack(encodeQr(text))).toBe(text);
  });
});

// 14-07 (P14-P11, DOM-10): inline QR SVG for the launch-review phone check (UI-SPEC PhoneCheckPanel).
import { describe, expect, it } from "vitest";
import { encodeQr } from "./encode";
import { qrSvg } from "./svg";

const LABEL = "QR code that opens your site in review mode on a phone";

describe("qrSvg", () => {
  const svg = qrSvg("https://review.example.test/r/abc", { label: LABEL });

  it("is one inline svg with a viewBox including the 4-module quiet zone", () => {
    const { size } = encodeQr("https://review.example.test/r/abc");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain(`viewBox="0 0 ${size + 8} ${size + 8}"`);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it("defaults to 160px square", () => {
    expect(svg).toContain('width="160"');
    expect(svg).toContain('height="160"');
  });

  it("honours px", () => {
    const big = qrSvg("x", { px: 200, label: LABEL });
    expect(big).toContain('width="200"');
    expect(big).toContain('height="200"');
  });

  it("draws a white background rect and exactly one black module path", () => {
    expect(svg).toMatch(/<rect [^>]*fill="#fff"/);
    expect(svg.match(/<path/g)).toHaveLength(1);
    expect(svg).toMatch(/<path [^>]*fill="#000"/);
    expect(svg).toContain('shape-rendering="crispEdges"');
  });

  it("carries role and the caller's aria-label", () => {
    expect(svg).toContain('role="img"');
    expect(svg).toContain(`aria-label="${LABEL}"`);
  });

  it("has no script, no external reference and no encoded text in the markup", () => {
    expect(svg).not.toMatch(/<script|href=|url\(|<image|<foreignObject/i);
    expect(svg).not.toContain("review.example.test");
  });

  it("escapes the label", () => {
    const evil = qrSvg("x", { label: '"><script>alert(1)</script>' });
    expect(evil).not.toContain("<script");
    expect(evil).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("path covers exactly the dark modules (run-length rows)", () => {
    const text = "https://review.example.test/r/abc";
    const q = encodeQr(text);
    const d = /<path [^>]*d="([^"]+)"/.exec(svg)![1]!;
    const painted = new Set<string>();
    for (const seg of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
      const x = Number(seg[1]);
      const y = Number(seg[2]);
      for (let i = 0; i < Number(seg[3]); i++)
        painted.add(`${y - 4},${x - 4 + i}`);
    }
    let dark = 0;
    q.modules.forEach((row, r) =>
      row.forEach((v, c) => {
        if (v) {
          dark++;
          expect(painted.has(`${r},${c}`)).toBe(true);
        }
      }),
    );
    expect(painted.size).toBe(dark);
  });

  it("rejects text that is too long", () => {
    expect(() => qrSvg("a".repeat(214), { label: LABEL })).toThrow(RangeError);
  });
});

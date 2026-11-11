// packages/core/src/qr/svg.ts (P14, DOM-10).
// Owner: 14-07 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// Inline SVG for the launch-review phone check (D172, UI-SPEC PhoneCheckPanel: 160px, 200px at
// >= 1024px). One black <path> of run-length row segments on a white <rect>, 4-module quiet zone.
// The encoded text never reaches the markup (only numbers do); the label is HTML-escaped.
// No script, no external reference. Pure TS.

import { escapeHtml } from "../email/escape";
import { encodeQr } from "./encode";

export interface QrSvgOptions {
  /** Rendered width and height in px, quiet zone included. Default 160. */
  px?: number;
  /** Accessible name (`aria-label`); the caller supplies the copy. */
  label: string;
}

const QUIET = 4;

/** Render `text` as a QR Code SVG string. Throws `RangeError` past the v10-M capacity. */
export function qrSvg(text: string, { px = 160, label }: QrSvgOptions): string {
  const { size, modules } = encodeQr(text);
  const side = size + QUIET * 2;
  const dim = Math.max(1, Math.round(px));
  let d = "";
  for (let r = 0; r < size; r++) {
    const row = modules[r]!;
    let c = 0;
    while (c < size) {
      if (!row[c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < size && row[c]) c++;
      const run = c - start;
      d += `M${start + QUIET} ${r + QUIET}h${run}v1h-${run}z`;
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" ` +
    `viewBox="0 0 ${side} ${side}" role="img" aria-label="${escapeHtml(label)}" ` +
    `shape-rendering="crispEdges">` +
    `<rect width="${side}" height="${side}" fill="#fff"/>` +
    `<path d="${d}" fill="#000"/>` +
    `</svg>`
  );
}

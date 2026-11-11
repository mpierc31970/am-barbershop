// HTTP Range parsing and public media MIME types (07-09, CONT-19; RFC 9110 §14). Pure: the
// /_media route uses both, and the 07-12/07-13 writers pass publicMediaMime() as the put
// content type so S3 stores the right type.
import type { PublicMediaVariant } from "../ports";
import type { ByteRange } from "../../storage/object-store";

const RANGE_RE = /^bytes=(\d{0,15})-(\d{0,15})$/;

/**
 * One `bytes=` range resolved against `size`. A syntactically invalid or multi-range header is
 * ignored (null, full response), never an error; a well-formed range that starts past the end
 * is "unsatisfiable" (416).
 */
export function parseRangeHeader(
  header: string | null | undefined,
  size: number,
): ByteRange | "unsatisfiable" | null {
  if (typeof header !== "string" || header === "") return null;
  if (!Number.isSafeInteger(size) || size <= 0) return null;
  const m = RANGE_RE.exec(header.trim());
  if (!m) return null;
  const [, a, b] = m as unknown as [string, string, string];
  if (a === "" && b === "") return null;
  if (a === "") {
    const suffix = Number(b);
    if (suffix === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(a);
  if (b !== "" && Number(b) < start) return null;
  if (start >= size) return "unsatisfiable";
  const end = b === "" ? size - 1 : Number(b);
  return { start, end: Math.min(end, size - 1) };
}

const MIME: Readonly<Record<PublicMediaVariant, string>> = Object.freeze({
  w480: "image/webp",
  w960: "image/webp",
  w1600: "image/webp",
  w2560: "image/webp",
  thumb: "image/webp",
  "poster.webp": "image/webp",
  "poster.jpg": "image/jpeg",
  "video.mp4": "video/mp4",
  "captions.vtt": "text/vtt; charset=utf-8",
  "audio.mp3": "audio/mpeg",
});

/** Content-Type for a public variant: from the allowlist, never from the upload (T-07-09-06). */
export function publicMediaMime(variant: PublicMediaVariant): string {
  return MIME[variant];
}

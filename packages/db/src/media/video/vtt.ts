// WebVTT captions check (07-13; CONT-18 captions, UI-SPEC UPL-CAPTIONS; T-07-13-07). Strict
// UTF-8, a `WEBVTT` header line, at least one cue timing line, no NUL, at most 512 KB. The
// returned text is normalised (BOM stripped, CRLF -> LF) so the stored file is clean.

export const VTT_MAX_BYTES = 512 * 1024;

const HEADER_RE = /^WEBVTT(?:[ \t].*)?$/;

export type VttCheck = { ok: true; text: string } | { ok: false };

export function checkVtt(bytes: Uint8Array): VttCheck {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0)
    return { ok: false };
  if (bytes.length > VTT_MAX_BYTES) return { ok: false };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false };
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.includes("\u0000")) return { ok: false };
  text = text.replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  if (!HEADER_RE.test(lines[0] ?? "")) return { ok: false };
  if (!lines.some((l) => l.includes("-->"))) return { ok: false };
  return { ok: true, text };
}

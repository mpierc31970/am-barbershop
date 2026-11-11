// Read a request body with a hard byte cap (WR-C05). The size guards on the public form and
// gate routes and the hub stock POST checked only the declared Content-Length, so a chunked
// body with no length was buffered whole (up to the 22 MB middleware cap) before any rate
// limit ran. This stops reading, and cancels the stream, the moment the cap is passed.
// Pure: no next/*.

/**
 * WR-D01: the Stripe webhook routes' body cap. Stripe events are well under 1 MB; the body is
 * read with this cap before the signature check, so a large or slow unauthenticated POST
 * cannot tie up memory on the app container (413).
 */
export const MAX_WEBHOOK_BYTES = 1024 * 1024;

/** The body's bytes, or null when the declared or the real length is over `max`. */
export async function readCappedBody(
  req: Request,
  max: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > max) return null;
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** The capped body as UTF-8 text, or null when it is over `max` bytes. */
export async function readCappedText(
  req: Request,
  max: number,
): Promise<string | null> {
  const bytes = await readCappedBody(req, max);
  return bytes === null ? null : new TextDecoder().decode(bytes);
}

/** The capped body parsed as form data (urlencoded or multipart), or null when over `max`. */
export async function readCappedFormData(
  req: Request,
  max: number,
): Promise<FormData | null> {
  const bytes = await readCappedBody(req, max);
  if (bytes === null) return null;
  return new Response(bytes, {
    headers: { "content-type": req.headers.get("content-type") ?? "" },
  }).formData();
}

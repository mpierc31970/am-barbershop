// POST /hub/api/studio/photo: a barber's portrait or gallery photo, from a plain multipart
// form on the seat screen (works without JS). Same order as /hub/api/media: same origin ->
// session -> Content-Length cap -> formData -> real size -> uploadSeatPhoto, which proves the
// seat is the caller's (a barber only their own) before the media pipeline runs.
// Always answers 303 back to the seat screen with a one-time note.
import { MAX_UPLOAD_BYTES, UPLOAD_COPY, uploadSeatPhoto } from "@cds/db";
import { cookies } from "next/headers";
import { toActionError } from "../../../../../../lib/action";
import {
  mediaContext,
  MULTIPART_OVERHEAD,
  sameOrigin,
} from "../../../../../../lib/media-route";
import {
  seatHref,
  STUDIO_BASE,
  STUDIO_NOTE_COOKIE,
} from "../../../../../../lib/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID = /^[a-z0-9]{15}$/;

async function back(
  req: Request,
  to: string,
  kind: "ok" | "error",
  text: string,
) {
  (await cookies()).set(STUDIO_NOTE_COOKIE, `${kind}:${text}`.slice(0, 600), {
    httpOnly: true,
    sameSite: "lax",
    path: "/hub",
    maxAge: 15,
    secure: process.env.NODE_ENV === "production",
  });
  return Response.redirect(new URL(to, req.url), 303);
}

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const ctx = await mediaContext();
  if (!ctx) return Response.redirect(new URL("/sign-in", req.url), 303);
  if (ctx instanceof Response) return ctx;

  const declared = Number(req.headers.get("content-length"));
  if (
    Number.isFinite(declared) &&
    declared > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD
  ) {
    return back(
      req,
      STUDIO_BASE,
      "error",
      UPLOAD_COPY.tooBig(declared - MULTIPART_OVERHEAD),
    );
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return back(req, STUDIO_BASE, "error", UPLOAD_COPY.failed);
  }
  const seatId = String(form.get("seatId") ?? "");
  if (!ID.test(seatId))
    return back(req, STUDIO_BASE, "error", UPLOAD_COPY.failed);
  const to = `${seatHref(seatId)}#photos`;
  const target = form.get("target") === "gallery" ? "gallery" : "photo";
  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    return back(req, to, "error", UPLOAD_COPY.type);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return back(req, to, "error", UPLOAD_COPY.tooBig(file.size));
  }
  try {
    await uploadSeatPhoto(
      ctx,
      seatId,
      new Uint8Array(await file.arrayBuffer()),
      target,
      {
        ...(file instanceof File ? { filename: file.name } : {}),
      },
    );
    return back(req, to, "ok", "Photo added.");
  } catch (err) {
    return back(req, to, "error", toActionError(err).message);
  }
}

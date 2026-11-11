// GET /hub/api/forms/files/<id>: download one Forms Pro upload from the Inbox (BILL-14, D234;
// 10-38; T-10-38-04, T-10-38-05). Platform host, hub session. The org comes only from the
// session; readFormFile checks content read and looks the file up inside that org, so another
// org's id, an unknown id, a signed-out visitor and a member without inbox access all get the
// same 404 (never a hint). The file is always a download, typed from the stored type, never
// rendered inline, and never cached.
import { readFormFile } from "@cds/db";
import { mediaContext } from "../../../../../../../lib/media-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const NOT_FOUND_HEADERS = { "Cache-Control": "private, no-store" } as const;

function notFound(): Response {
  return new Response("Not Found", { status: 404, headers: NOT_FOUND_HEADERS });
}

/** `filename="ascii"` for old clients plus RFC 5987 `filename*` for the real name. */
function disposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\;]/g, "_");
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii || "file"}"; filename*=UTF-8''${encoded}`;
}

export async function GET(
  _req: Request,
  { params }: Params,
): Promise<Response> {
  const ctx = await mediaContext();
  if (!ctx) return notFound();
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  try {
    const file = await readFormFile(ctx, id);
    return new Response(file.stream, {
      status: 200,
      headers: {
        "Content-Type": file.type,
        "Content-Length": String(file.size),
        "Content-Disposition": disposition(file.name),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    if (
      code === "not_found" ||
      code === "invalid_input" ||
      code === "forbidden" ||
      code === "impersonation_denied"
    ) {
      return notFound();
    }
    console.error("[forms] file download failed", code ?? "unknown");
    return new Response("Error", { status: 500, headers: NOT_FOUND_HEADERS });
  }
}

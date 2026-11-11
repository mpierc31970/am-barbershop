// /staff/api/support-file/<id> (13-35, deviation Rule 2; STAFF-08; 13-UI-SPEC "Thread column"
// attachments). The console's download for a support attachment or CDS document of any site:
// the same read support:show --download makes (staffOpenSupportFile, support_read), behind the
// staff session cookie (a forwarded link is useless without it). GET reads only; nothing is
// written. Signed out → /staff/sign-in; a role without support_read, a malformed or unknown
// id → the same plain 404. Headers: private, no-store, nosniff, CSP sandbox; detected images
// inline, everything else an attachment with a cleaned filename. Errors log the class name
// only, never an id, a name or a body.
import { staffOpenSupportFile, type OpenedSupportFile } from "@cds/db";
import { getStaffSession, staffCan } from "../../../../../../lib/staff-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RECORD_ID = /^[a-z0-9]{15}$/;
const SAFE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { ...SAFE_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
  });
}

/** ASCII-only, quote-free filename plus an RFC 5987 UTF-8 copy (as the hub route). */
function disposition(kind: "inline" | "attachment", name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).replace(/[^A-Za-z0-9]/g, "") : "";
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .replace(/[^A-Za-z0-9._ -]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-. ]+|[-. ]+$/g, "")
    .slice(0, 100);
  const ascii = `${base || "file"}${ext ? `.${ext}` : ""}`;
  const utf8 = encodeURIComponent(name.replace(/[\r\n"]/g, "")).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  let session: Awaited<ReturnType<typeof getStaffSession>>;
  try {
    session = await getStaffSession();
  } catch (err) {
    console.error("[staff support-file] session failed", errName(err));
    return notFound();
  }
  if (!session) {
    return new Response(null, {
      status: 302,
      headers: { ...SAFE_HEADERS, Location: "/staff/sign-in" },
    });
  }
  if (!staffCan(session.role, "support_read")) return notFound();
  const { id } = await params;
  if (typeof id !== "string" || !RECORD_ID.test(id)) return notFound();

  let opened: OpenedSupportFile;
  try {
    opened = await staffOpenSupportFile(session.ctx, id);
  } catch (err) {
    if (errName(err) !== "NotFound") {
      console.error("[staff support-file] open failed", errName(err));
    }
    return notFound();
  }
  const textual = opened.mime.startsWith("text/");
  return new Response(opened.stream, {
    headers: {
      ...SAFE_HEADERS,
      "Content-Type": textual ? `${opened.mime}; charset=utf-8` : opened.mime,
      "Content-Length": String(opened.size),
      "Content-Disposition": disposition(
        opened.inline ? "inline" : "attachment",
        opened.filename,
      ),
    },
  });
}

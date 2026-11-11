// POST /api/gate/<pageId> on tenant hosts: the password gate check (CONT-28, CONT-33;
// D235 #12, D255; 07-32 choices 4-6; T-07-32-01..05, T-07-32-08).
//
// The site comes only from the middleware's tenant header via siteForRoute (unknown host =
// 404). A cross-origin Origin header is refused (403). The body is read once, at most 4 KB;
// anything bigger is a wrong password (counted). verifyPagePassword takes a slot in the
// per-(org, page, IP) limiter before comparing and gives it back on success.
// Success sets cds_pp_<pageId> (HMAC over org, page, password_version, exp; 12 h; Path=/,
// HttpOnly, SameSite=Lax, Secure on HTTPS or in production). The redirect target is always the
// page's own path from the org's manifest by id; any client `return` field is ignored (no
// open redirect). `Accept: application/json` (PasswordGateEnhancer) gets JSON; anything else a
// 303. Never logs the password or the cookie; logs carry only the error class.
import { NotFound, TENANT_HOST_HEADER, normalizeHost } from "@cds/core";
import { GATE_COPY } from "@cds/core/content";
import {
  GateRateLimited,
  WrongPagePassword,
  mintGateCookie,
  verifyPagePassword,
} from "@cds/db";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import {
  clampWait,
  gatePathFor,
  gateStatusUrl,
} from "../../../../../../lib/gate-status";
import { readCappedText } from "../../../../../../lib/capped-body";
import { clientIp } from "../../../../../../lib/session";
import { getManifest } from "../../../../../../lib/site-cache";
import { siteForRoute } from "../../../../../../lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 4096;
const NO_STORE = { "Cache-Control": "no-store" };
// An over-long body is checked as this (never matches: a password is at most 128 chars).
const TOO_LONG = "\u0000".repeat(129);

type Params = { params: Promise<{ host: string; pageId: string }> };

function plain(status: number): Response {
  return new Response(status === 404 ? "Not Found" : "Forbidden", {
    status,
    headers: NO_STORE,
  });
}

function json(status: number, body: unknown): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function see(location: string): NextResponse {
  return new NextResponse(null, {
    status: 303,
    headers: { ...NO_STORE, Location: location },
  });
}

// WR-C03: the tenant header is normalizeHost'd (no port), so the Origin is compared the
// same way; otherwise every post from a non-default port (dev, Lighthouse, e2e) is a 403.
function sameOrigin(origin: string | null, host: string): boolean {
  if (origin === null) return true;
  try {
    const from = normalizeHost(new URL(origin).host);
    return from !== null && from === normalizeHost(host);
  } catch {
    return false;
  }
}

/** The password from a ≤ 4 KB body (form or JSON); TOO_LONG when the body is too big. */
async function passwordOf(req: Request): Promise<string> {
  // WR-C05: the cap holds even with no Content-Length (chunked).
  let body: string | null;
  try {
    body = await readCappedText(req, MAX_BODY);
  } catch {
    return "";
  }
  if (body === null) return TOO_LONG;
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  if (type.startsWith("application/json")) {
    try {
      const v = (JSON.parse(body) as { password?: unknown }).password;
      return typeof v === "string" ? v : "";
    } catch {
      return "";
    }
  }
  return new URLSearchParams(body).get("password") ?? "";
}

export async function POST(
  req: Request,
  { params }: Params,
): Promise<Response> {
  const { host, pageId } = await params;
  const site = await siteForRoute(host);
  if (!site) return plain(404);
  const tenantHost = (await headers()).get(TENANT_HOST_HEADER) ?? site.host;
  if (!sameOrigin(req.headers.get("origin"), tenantHost)) return plain(403);

  const wantsJson = (req.headers.get("accept") ?? "").includes(
    "application/json",
  );

  let path: string | null;
  try {
    path = gatePathFor(await getManifest(site), pageId);
  } catch {
    path = null;
  }
  if (path === null) return plain(404);

  const password = await passwordOf(req);
  const now = new Date();
  try {
    const result = await verifyPagePassword(site, pageId, password, {
      ip: await clientIp(),
    });
    const res = wantsJson ? json(200, { ok: true, location: path }) : see(path);
    if (!result.open) {
      const cookie = mintGateCookie({
        orgId: site.orgId,
        pageId,
        version: result.version,
        now,
      });
      const secure =
        process.env.CDS_ENV === "production" ||
        (req.headers.get("x-forwarded-proto") ?? "")
          .split(",")[0]!
          .trim()
          .toLowerCase() === "https";
      res.cookies.set(cookie.name, cookie.value, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure,
        maxAge: cookie.maxAge,
      });
    }
    return res;
  } catch (err) {
    if (err instanceof WrongPagePassword) {
      return wantsJson
        ? json(401, { error: GATE_COPY.wrong })
        : see(gateStatusUrl(path, { kind: "wrong" }));
    }
    if (err instanceof GateRateLimited) {
      const waitMinutes = clampWait(Math.ceil(err.retryAfterS / 60));
      return wantsJson
        ? json(429, { error: GATE_COPY.rate, retryAfterS: err.retryAfterS })
        : see(gateStatusUrl(path, { kind: "rate", waitMinutes }));
    }
    if (err instanceof NotFound) return plain(404);
    console.error("[gate] error", err instanceof Error ? err.name : "error");
    return wantsJson ? json(500, { error: GATE_COPY.wrong }) : see(path);
  }
}

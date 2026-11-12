// POST /api/book on tenant hosts: the /book contact form (Studio Booking step 2). The site
// comes only from siteForRoute; createPublicBooking re-checks the barber, service and open
// time under the studio lock. Answers 303: /book?booked=... on success, back to the same
// step with ?error=<code> otherwise. A filled honeypot gets the same success-shaped
// redirect (no booking). Logs carry the error class only, never the visitor's details.
import { CdsError, InvalidInput, RateLimited } from "@cds/core";
import { createPublicBooking, SLOT_TAKEN_COPY } from "@cds/db";
import { readCappedFormData } from "../../../../../lib/capped-body";
import { clientIp } from "../../../../../lib/session";
import { siteForRoute } from "../../../../../lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 16 * 1024;

/** A relative Location: req.url carries the internal host after the tenant rewrite. */
function back(_req: Request, q: Record<string, string>): Response {
  return new Response(null, {
    status: 303,
    headers: {
      Location: `/book?${new URLSearchParams(q)}${q.booked ? "" : q.error ? "#book-error" : "#step-3"}`,
    },
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ host: string }> },
): Promise<Response> {
  const { host } = await params;
  const site = await siteForRoute(host);
  if (!site) return new Response(null, { status: 404 });
  const form = await readCappedFormData(req, MAX_BODY).catch(() => null);
  if (!form) return back(req, { error: "failed" });
  const f = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : "";
  };
  const pick = { barber: f("barber"), service: f("service"), date: f("date") };
  if (f("website") !== "") return back(req, { booked: "received" });
  try {
    const r = await createPublicBooking(
      site,
      {
        ...pick,
        time: f("time"),
        name: f("name"),
        email: f("email"),
        phone: f("phone"),
        note: f("note"),
      },
      await clientIp(),
    );
    return back(req, {
      booked: r.reference,
      b: r.barber,
      s: r.service,
      w: r.when,
    });
  } catch (err) {
    if (err instanceof RateLimited)
      return back(req, { ...pick, error: "rate" });
    if (err instanceof InvalidInput) {
      // The time they lost goes back so the page can name it (the page re-validates it).
      if (err.message === SLOT_TAKEN_COPY) {
        return back(req, { ...pick, error: "taken", at: f("time") });
      }
      return back(req, { ...pick, error: "input" });
    }
    if (!(err instanceof CdsError)) {
      console.error(
        `[book] failed: ${err instanceof Error ? err.name : "error"}`,
      );
    }
    return back(req, { ...pick, error: "failed" });
  }
}

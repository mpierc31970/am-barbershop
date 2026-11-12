// /book/cancel: the client's cancel link. GET shows the booking and a POST button (never
// cancels); late / closed / cancelled / unknown each get their message; the route posts the
// token and comes back to the page.
import { RateLimited } from "@cds/core";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  publicCancelView: vi.fn(),
  cancelPublicBooking: vi.fn(),
}));
vi.mock("@cds/db", () => db);
vi.mock("../lib/tenant", () => ({
  siteForRequest: async () => ({ orgId: "org1" }),
  siteForRoute: async () => ({ orgId: "org1" }),
}));
vi.mock("../lib/session", () => ({ clientIp: async () => "203.0.113.9" }));

const { default: CancelPage } =
  await import("../app/tenant/[host]/book/cancel/page");
const { POST } = await import("../app/tenant/[host]/api/book/cancel/route");

const VIEW = {
  barber: "Carlos",
  service: "Cut",
  when: "Thursday, November 12 at 10:00 am",
  reference: "AM-ABC123",
  shopName: "A&M Barber Studio",
  shopPhone: "555-0100",
};

async function render(sp: Record<string, string>): Promise<string> {
  const el = await CancelPage({
    params: Promise.resolve({ host: "barber.test" }),
    searchParams: Promise.resolve(sp),
  });
  return renderToStaticMarkup(el as ReactElement);
}

describe("/book/cancel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ok: the booking and a POST form; the GET itself cancels nothing", async () => {
    db.publicCancelView.mockResolvedValue({ state: "ok", ...VIEW });
    const html = await render({ t: "v1.tok" });
    expect(html).toContain("AM-ABC123");
    expect(html).toContain('action="/api/book/cancel"');
    expect(html).toContain('method="post"');
    expect(html).toContain('value="v1.tok"');
    expect(db.cancelPublicBooking).not.toHaveBeenCalled();
  });

  it("late, closed and cancelled: no button; call the shop with its phone", async () => {
    db.publicCancelView.mockResolvedValue({ state: "late", ...VIEW });
    let html = await render({ t: "x" });
    expect(html).toContain("too close to your appointment");
    expect(html).toContain("555-0100");
    expect(html).not.toContain("<form");
    db.publicCancelView.mockResolvedValue({ state: "closed", ...VIEW });
    html = await render({ t: "x" });
    expect(html).toContain("can&#x27;t be changed online");
    db.publicCancelView.mockResolvedValue({ state: "cancelled", ...VIEW });
    html = await render({ t: "x" });
    expect(html).toContain("Your appointment is cancelled");
  });

  it("an unknown token: a generic not-found message, no booking details", async () => {
    db.publicCancelView.mockResolvedValue({ state: "notfound" });
    const html = await render({ t: "junk" });
    expect(html).toContain("couldn&#x27;t find that appointment");
    expect(html).not.toContain("<form");
  });

  it("the route cancels by token and 303s back; rate limited says so", async () => {
    const post = () =>
      POST(
        new Request("http://barber.test/api/book/cancel", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ t: "v1.tok" }),
        }),
        { params: Promise.resolve({ host: "barber.test" }) },
      );
    db.cancelPublicBooking.mockResolvedValue({ state: "cancelled", ...VIEW });
    let res = await post();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/book/cancel?t=v1.tok");
    expect(db.cancelPublicBooking).toHaveBeenCalledWith(
      { orgId: "org1" },
      "v1.tok",
      "203.0.113.9",
    );
    db.cancelPublicBooking.mockRejectedValue(new RateLimited("slow down"));
    res = await post();
    expect(res.headers.get("location")).toContain("error=rate");
  });
});

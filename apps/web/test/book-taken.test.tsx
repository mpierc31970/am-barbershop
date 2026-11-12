// /book when the time was just taken: the route sends the lost time back (error=taken&at=),
// and the page names it in an alert box, keeps barber / service / day and lists that day's
// remaining open times (server-rendered, no JS needed).
import { InvalidInput } from "@cds/core";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  SLOT_TAKEN_COPY: "That time was just taken. Pick another time.",
  createPublicBooking: vi.fn(),
  listPublicSeats: vi.fn(),
  publicAvailability: vi.fn(),
}));
vi.mock("@cds/db", () => db);
vi.mock("../lib/tenant", () => ({
  siteForRequest: async () => ({ orgId: "org1" }),
  siteForRoute: async () => ({ orgId: "org1" }),
}));
vi.mock("../lib/session", () => ({ clientIp: async () => "203.0.113.9" }));

const { default: BookPage } = await import("../app/tenant/[host]/book/page");
const { POST } = await import("../app/tenant/[host]/api/book/route");

const SEAT = {
  id: "s1",
  slug: "carlos",
  name: "Carlos",
  headline: "",
  bio: "",
  photo: "",
  services: [
    {
      id: "nk99cgwposc8vi0",
      name: "Cut",
      durationMinutes: 30,
      priceCents: 3000,
    },
  ],
};

async function render(sp: Record<string, string>): Promise<string> {
  const el = await BookPage({
    params: Promise.resolve({ host: "barber.test" }),
    searchParams: Promise.resolve(sp),
  });
  return renderToStaticMarkup(el as ReactElement);
}

describe("/book: the time was just taken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.listPublicSeats.mockResolvedValue([SEAT]);
    db.publicAvailability.mockResolvedValue({
      tz: "America/Chicago",
      days: [{ date: "2026-11-12", label: "Thu, Nov 12", open: true }],
      slots: [
        { time: "11:00", startsAt: 0, endsAt: 0 },
        { time: "13:00", startsAt: 0, endsAt: 0 },
      ],
    });
  });

  it("names the lost time and shows the day's other open times", async () => {
    const html = await render({
      barber: "carlos",
      service: "nk99cgwposc8vi0",
      date: "2026-11-12",
      error: "taken",
      at: "10:00",
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain('id="book-error"');
    expect(html).toContain(
      "Sorry — someone just booked 10:00 am on Thu, Nov 12 with Carlos. Please choose a different time.",
    );
    expect(html).toContain("11:00 am");
    expect(html).toContain("1:00 pm");
    expect(html).toContain('aria-current="date"');
    expect(html).toContain("✓ Cut");
  });

  it("a junk time falls back to the plain message", async () => {
    const html = await render({
      barber: "carlos",
      service: "nk99cgwposc8vi0",
      date: "2026-11-12",
      error: "taken",
      at: "<b>",
    });
    expect(html).toContain("That time was just taken. Pick another time.");
    expect(html).not.toContain("&lt;b&gt;");
  });

  it("the route sends the time back with error=taken", async () => {
    db.createPublicBooking.mockRejectedValue(
      new InvalidInput(db.SLOT_TAKEN_COPY),
    );
    const body = new URLSearchParams({
      barber: "carlos",
      service: "nk99cgwposc8vi0",
      date: "2026-11-12",
      time: "10:00",
      name: "Missed Test",
      email: "m@example.com",
    });
    const res = await POST(
      new Request("http://barber.test/api/book", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      }),
      { params: Promise.resolve({ host: "barber.test" }) },
    );
    expect(res.status).toBe(303);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("error=taken");
    expect(loc).toContain("at=10%3A00");
    expect(loc).toContain("barber=carlos");
    expect(loc).toMatch(/#book-error$/);
  });
});

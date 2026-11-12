// /book/cancel?t=<token> on tenant hosts: the "Cancel this appointment" link in a client's
// booking emails. Shows the booking and a POST button (/api/book/cancel); this GET never
// changes anything (mail scanners prefetch links). Works without JavaScript.
import { publicCancelView, type CancelView } from "@cds/db";
import { PageTitleHeader, siteButtonClasses } from "@cds/ui/site";
import type { Metadata } from "next";
import Link from "next/link";
import { siteForRequest } from "../../../../../lib/tenant";
import { MUTED } from "../../barbers/BarberViews";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cancel your appointment",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type SP = Record<string, string | string[] | undefined>;
type Props = { params: Promise<{ host: string }>; searchParams?: Promise<SP> };

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function callShop(v: Exclude<CancelView, { state: "notfound" }>): string {
  return v.shopPhone ? `call ${v.shopName} at ${v.shopPhone}` : "call the shop";
}

export default async function CancelPage({ params, searchParams }: Props) {
  const { host } = await params;
  const site = await siteForRequest(host);
  const sp = searchParams ? await searchParams : {};
  const token = one(sp.t);
  const rate = one(sp.error) === "rate";
  let view: CancelView = { state: "notfound" };
  try {
    view = await publicCancelView(site, token);
  } catch {
    console.error("[book-cancel] read failed");
  }

  let body;
  if (view.state === "notfound") {
    body = (
      <p role="alert" className="border border-site-primary px-4 py-3">
        We couldn&apos;t find that appointment. The link may be incomplete. Call
        the shop if you need to change a booking.
      </p>
    );
  } else {
    const facts = (
      <p>
        <strong>{view.barber}</strong> · {view.service} · {view.when} · Booking{" "}
        {view.reference}
      </p>
    );
    body =
      view.state === "ok" ? (
        <>
          {rate ? (
            <p role="alert" className="border border-site-primary px-4 py-3">
              Too many tries from this device. Please {callShop(view)}.
            </p>
          ) : null}
          {facts}
          <form method="post" action="/api/book/cancel">
            <input type="hidden" name="t" value={token} />
            <button type="submit" className={siteButtonClasses("primary")}>
              Cancel appointment
            </button>
          </form>
          <p className={`text-sm ${MUTED}`}>
            You can cancel online up to 2 hours before your appointment.
          </p>
        </>
      ) : (
        <>
          <p role="status" className="border border-site-primary px-4 py-3">
            {view.state === "cancelled"
              ? "Your appointment is cancelled. We emailed you a confirmation."
              : view.state === "late"
                ? `It's too close to your appointment to cancel online. Please ${callShop(view)}.`
                : `This booking can't be changed online any more. Please ${callShop(view)}.`}
          </p>
          {facts}
        </>
      );
  }

  return (
    <main id="content" tabIndex={-1} className="outline-none">
      <PageTitleHeader title="Cancel your appointment" />
      <div
        className="mx-auto flex max-w-[720px] flex-col gap-4 px-6 pb-16 md:px-8"
        data-book-cancel={view.state}
      >
        {body}
        <div>
          <Link href="/book" className={siteButtonClasses("secondary")}>
            Book a time
          </Link>
        </div>
      </div>
    </main>
  );
}

// /hub/studio-booking: Barbers. The owner (and Admins) see every seat and add barbers; a
// barber (renter/staff member with the Studio Booking grant) goes straight to their own seat.
// Who may read what is decided in @cds/db (listSeats): this page only lays it out.
import { listSeats } from "@cds/db";
import {
  Badge,
  Button,
  EmptyState,
  InlineAlert,
  Select,
  TextField,
} from "@cds/ui/hub";
import { ScreenHeader } from "@cds/ui/hub/shell";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { addSeatAction, setSeatShownAction } from "../../../actions/studio";
import { requireHubSession } from "../../../../lib/session";
import { readStudioNote, seatHref } from "../../../../lib/studio";
import { GuardedLink } from "../GuardedLink";
import { StudioTabs } from "./StudioTabs";

export const metadata: Metadata = { title: "Barbers" };
export const dynamic = "force-dynamic";

const KIND_OPTIONS = [
  { value: "renter", label: "Chair renter (pays rent)" },
  { value: "staff", label: "Employee" },
];

export default async function StudioBookingPage() {
  const { ctx, org } = await requireHubSession();
  const site = org.primaryHost ? `https://${org.primaryHost}` : "";
  const manager = ctx.role === "owner" || ctx.role === "admin";
  const seats = await listSeats(ctx);
  if (!manager) {
    if (seats[0]) redirect(seatHref(seats[0].id));
  }
  const note = await readStudioNote();

  return (
    <div className="flex w-full max-w-[880px] flex-col gap-8 font-hub text-hub-ink">
      <ScreenHeader
        title="Barbers"
        helpId="addon-studio-booking"
        LinkComponent={GuardedLink}
      />
      {manager ? <StudioTabs active="barbers" manager /> : null}
      {note ? (
        <InlineAlert tone={note.tone === "success" ? "success" : "error"}>
          {note.text}
        </InlineAlert>
      ) : null}
      {!manager ? (
        <EmptyState
          heading="Your seat isn't set up yet"
          body="Ask the shop owner to add you with the email you signed in with."
        />
      ) : (
        <>
          <section aria-labelledby="seats-h" className="flex flex-col gap-3">
            <h2 id="seats-h" className="text-xl font-semibold">
              Seats
            </h2>
            {seats.length === 0 ? (
              <p className="text-hub-ink-muted">
                No barbers yet. Add the first one below.
              </p>
            ) : (
              <ul className="divide-y divide-hub-border rounded border border-hub-border bg-hub-surface">
                {seats.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center gap-3 px-4 py-3"
                  >
                    <Link
                      href={seatHref(s.id)}
                      className="min-w-0 flex-1 font-semibold underline-offset-2 hover:underline"
                    >
                      {s.name}
                      <span className="block text-sm font-normal text-hub-ink-muted">
                        {s.kind === "staff" ? "Employee" : "Chair renter"}
                        {s.email ? ` · ${s.email}` : ""} · {s.services.length}{" "}
                        services
                      </span>
                    </Link>
                    <Badge tone={s.isPublished ? "published" : "draft"}>
                      {s.isPublished ? "On the site" : "Hidden"}
                    </Badge>
                    <form action={setSeatShownAction}>
                      <input type="hidden" name="seatId" value={s.id} />
                      <input
                        type="hidden"
                        name="show"
                        value={s.isPublished ? "0" : "1"}
                      />
                      <Button type="submit" size="sm" variant="secondary">
                        {s.isPublished ? "Hide" : "Show"}
                      </Button>
                    </form>
                    <Badge tone={s.linked ? "done" : "needed"}>
                      {s.linked ? "Signed in" : "Not signed in yet"}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="add-h" className="flex flex-col gap-3">
            <h2 id="add-h" className="text-xl font-semibold">
              Add a barber
            </h2>
            <form
              action={addSeatAction}
              className="grid gap-4 rounded border border-hub-border bg-hub-surface p-4 sm:grid-cols-2"
            >
              <TextField
                id="seat-name"
                name="name"
                label="Name"
                required
                maxLength={80}
              />
              <TextField
                id="seat-email"
                name="email"
                type="email"
                label="Email"
                helper="They sign in with this address to edit their own page."
                maxLength={254}
              />
              <Select
                id="seat-kind"
                name="kind"
                label="Seat"
                options={KIND_OPTIONS}
                defaultValue="renter"
              />
              <div className="flex items-end">
                <Button type="submit" variant="primary">
                  Add barber
                </Button>
              </div>
            </form>
          </section>
          {site ? (
            <p className="text-sm text-hub-ink-muted">
              Published barbers are listed at{" "}
              <a
                className="underline"
                href={`${site}/barbers`}
                target="_blank"
                rel="noreferrer"
              >
                {site.replace("https://", "")}/barbers
              </a>
              .
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

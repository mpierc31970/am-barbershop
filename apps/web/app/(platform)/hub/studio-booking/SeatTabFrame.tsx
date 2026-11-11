// A&M fork: the frame for a per-barber Studio Booking tab (My Social, Services & Pricing).
// A barber always works on their own seat; the owner (and Admins) pick a barber with
// ?seat=<id> (first barber by default). getSeat answers NotFound for a seat the caller may
// not open, so a barber can never reach another barber's tab by editing the URL.
import { getSeat, listSeats, mySeatId, type SeatView } from "@cds/db";
import { InlineAlert } from "@cds/ui/hub";
import { ScreenHeader } from "@cds/ui/hub/shell";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { requireHubSession } from "../../../../lib/session";
import { readStudioNote, STUDIO_BASE } from "../../../../lib/studio";
import { GuardedLink } from "../GuardedLink";
import { StudioTabs, type StudioTab } from "./StudioTabs";

const ID = /^[a-z0-9]{15}$/;

/** The seat this tab works on, or a 404 (no seat, or one the caller may not open). */
export async function seatForTab(
  searchParams:
    Promise<Record<string, string | string[] | undefined>> | undefined,
): Promise<{ seat: SeatView; manager: boolean; seats: SeatView[] }> {
  const { ctx } = await requireHubSession();
  const manager = ctx.role === "owner" || ctx.role === "admin";
  const sp = searchParams ? await searchParams : {};
  const asked = typeof sp.seat === "string" && ID.test(sp.seat) ? sp.seat : "";
  try {
    if (manager) {
      const seats = await listSeats(ctx);
      const id = asked || seats[0]?.id;
      if (!id) notFound();
      return { seat: await getSeat(ctx, id), manager, seats };
    }
    const own = await mySeatId(ctx);
    if (!own) notFound();
    return { seat: await getSeat(ctx, own), manager, seats: [] };
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith("NEXT_")) throw err;
    notFound();
  }
}

export async function SeatTabFrame({
  title,
  tab,
  path,
  seat,
  manager,
  seats,
  children,
}: {
  title: string;
  tab: StudioTab;
  /** This tab's route under STUDIO_BASE, e.g. "/services". */
  path: string;
  seat: SeatView;
  manager: boolean;
  seats: SeatView[];
  children: ReactNode;
}) {
  const note = await readStudioNote();
  return (
    <div className="flex w-full max-w-[880px] flex-col gap-8 font-hub text-hub-ink">
      <ScreenHeader
        title={manager ? `${title}: ${seat.name}` : title}
        helpId="addon-studio-booking"
        LinkComponent={GuardedLink}
      />
      <StudioTabs active={tab} manager={manager} />
      {note ? (
        <InlineAlert tone={note.tone === "success" ? "success" : "error"}>
          {note.text}
        </InlineAlert>
      ) : null}
      {manager && seats.length > 1 ? (
        <nav aria-label="Barber" className="flex flex-wrap gap-2 text-sm">
          {seats.map((s) => (
            <GuardedLink
              key={s.id}
              href={`${STUDIO_BASE}${path}?seat=${s.id}`}
              className={`rounded border px-3 py-1 ${s.id === seat.id ? "border-hub-accent font-semibold" : "border-hub-border"}`}
            >
              {s.name}
            </GuardedLink>
          ))}
        </nav>
      ) : null}
      {children}
    </div>
  );
}

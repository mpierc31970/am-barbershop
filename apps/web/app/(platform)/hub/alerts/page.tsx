// /hub/alerts (A&M fork): the first screen after sign-in, for everyone. The person's own
// alerts (the bell's rows), newest first. A booking alert acts in place: Email, Call or Text
// the client, and Approve / Decline while the booking is a request (bookingStatusAction,
// which comes back here). Other alerts link to where they happened.
import { DEFAULT_TIME_ZONE } from "@cds/core/today";
import {
  listBell,
  listBookings,
  statsTimeZone,
  type BellAlert,
  type BookingView,
} from "@cds/db";
import { Badge, Button, EmptyState, InlineAlert } from "@cds/ui/hub";
import { ScreenHeader } from "@cds/ui/hub/shell";
import { Mail, MessageSquare, Phone } from "lucide-react";
import type { Metadata } from "next";
import { bookingStatusAction } from "../../../actions/studio";
import { bellKeysFrom } from "../../../../lib/bell";
import { getNeedsYou } from "../../../../lib/needs-you";
import { requireHubSession } from "../../../../lib/session";
import { readStudioNote } from "../../../../lib/studio";
import { GuardedLink } from "../GuardedLink";
import { ALL_NEEDS_YOU_FAILED } from "../nav";
import { alertActions, type ContactLink } from "./alert-actions";

export const metadata: Metadata = { title: "Alerts" };
export const dynamic = "force-dynamic";

const CONTACT: Record<
  ContactLink["kind"],
  { label: string; Icon: typeof Mail }
> = {
  email: { label: "Email", Icon: Mail },
  call: { label: "Call", Icon: Phone },
  text: { label: "Text", Icon: MessageSquare },
};

const LINK =
  "inline-flex min-h-11 items-center gap-2 rounded border border-hub-border-strong " +
  "bg-hub-surface px-3 text-sm font-semibold text-hub-ink hover:bg-hub-surface-2";

const STATUS: Partial<Record<BookingView["status"], string>> = {
  requested: "Waiting for you",
  confirmed: "Approved",
  declined: "Declined",
  cancelled: "Cancelled",
};

function Decide({ id, to, label }: { id: string; to: string; label: string }) {
  return (
    <form action={bookingStatusAction}>
      <input type="hidden" name="bookingId" value={id} />
      <input type="hidden" name="status" value={to} />
      <input type="hidden" name="back" value="/hub/alerts" />
      <Button
        type="submit"
        variant={to === "confirmed" ? "primary" : "secondary"}
      >
        {label}
      </Button>
    </form>
  );
}

function whenOf(iso: string, tz: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

async function loadAlerts(
  ctx: Awaited<ReturnType<typeof requireHubSession>>["ctx"],
): Promise<{ rows: BellAlert[]; tz: string; failed: boolean }> {
  const needsYou = await getNeedsYou().catch(() => ({
    items: [],
    failed: [...ALL_NEEDS_YOU_FAILED],
  }));
  try {
    const [rows, tz] = await Promise.all([
      listBell(ctx, { needsYouKeys: bellKeysFrom(needsYou), limit: 100 }),
      statsTimeZone(ctx).catch(() => DEFAULT_TIME_ZONE),
    ]);
    return { rows, tz, failed: false };
  } catch (err) {
    console.error(
      `[alerts] list failed ${err instanceof Error ? err.name : typeof err}`,
    );
    return { rows: [], tz: DEFAULT_TIME_ZONE, failed: true };
  }
}

export default async function AlertsPage() {
  const { ctx } = await requireHubSession();
  const [{ rows, tz, failed }, bookings, note] = await Promise.all([
    loadAlerts(ctx),
    // Only the bookings this person may see (a barber their own); none without the add-on.
    listBookings(ctx)
      .then((r) => r.bookings)
      .catch(() => [] as BookingView[]),
    readStudioNote(),
  ]);
  const byId = new Map(bookings.map((b) => [b.id, b]));

  return (
    <div className="flex w-full max-w-[720px] flex-col gap-6 font-hub text-hub-ink">
      <ScreenHeader title="Alerts" helpId="profile" LinkComponent={GuardedLink}>
        <GuardedLink
          href="/hub/profile#alerts"
          className="text-sm text-hub-ink-muted underline"
        >
          Alert settings
        </GuardedLink>
      </ScreenHeader>
      {note ? (
        <InlineAlert tone={note.tone === "success" ? "success" : "error"}>
          {note.text}
        </InlineAlert>
      ) : null}
      {failed ? (
        <InlineAlert tone="error">
          We couldn&apos;t load your alerts. Refresh to try again.
        </InlineAlert>
      ) : rows.length === 0 ? (
        <EmptyState
          heading="No alerts yet"
          body="Booking requests and anything else that needs you show here."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((a) => {
            const act = alertActions(a.sourceKey, byId);
            const b = act.booking;
            const status = b ? STATUS[b.status] : undefined;
            return (
              <li
                key={a.id}
                className="flex flex-col gap-3 rounded border border-hub-border bg-hub-surface p-4"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <p className="min-w-0 flex-1 text-base font-semibold">
                    {a.title}
                  </p>
                  {!a.read && !a.cleared ? (
                    <Badge tone="unread">New</Badge>
                  ) : null}
                  {status ? (
                    <Badge
                      tone={b?.status === "requested" ? "waiting" : "draft"}
                    >
                      {status}
                    </Badge>
                  ) : null}
                </div>
                <p className="text-sm text-hub-ink-muted">
                  {whenOf(a.createdAt, tz)}
                  {b
                    ? ` · ${b.clientName}${b.clientPhone ? ` · ${b.clientPhone}` : ""}`
                    : ""}
                </p>
                {b?.note ? <p className="text-sm">“{b.note}”</p> : null}
                <div className="flex flex-wrap gap-2">
                  {act.decide && b ? (
                    <>
                      <Decide id={b.id} to="confirmed" label="Approve" />
                      <Decide id={b.id} to="declined" label="Decline" />
                    </>
                  ) : null}
                  {act.contact.map((c) => {
                    const { label, Icon } = CONTACT[c.kind];
                    return (
                      <a key={c.kind} href={c.href} className={LINK}>
                        <Icon aria-hidden size={16} strokeWidth={2} />
                        {label}
                      </a>
                    );
                  })}
                  {!b && a.href && a.href !== "/hub/alerts" ? (
                    <GuardedLink href={a.href} className={LINK}>
                      Open
                    </GuardedLink>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

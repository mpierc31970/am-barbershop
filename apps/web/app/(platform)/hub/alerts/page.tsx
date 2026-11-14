// /hub/alerts (A&M fork): the first screen after sign-in, for everyone. The person's own
// alerts (the bell's rows), newest first. A booking alert acts in place: Email, Call or Text
// the client, and Approve / Decline while the booking is a request (bookingStatusAction,
// which re-renders this screen in place with the new status and a note). Other alerts link to where they happened. Opening the screen
// marks the person's alerts read (markAllRead: org + actor only). A barber's new gallery
// photo ("gallery:<seat>:<media>") shows its thumbnail and, for the owner/admins, Add to
// Gallery / Skip (galleryPhotoAction, in place like Approve / Decline).
import { DEFAULT_TIME_ZONE } from "@cds/core/today";
import {
  galleryOfferOf,
  isStudioManager,
  listBell,
  listBookings,
  listMissedBookings,
  listTeamAlerts,
  markAllRead,
  statsTimeZone,
  type BellAlert,
  type BookingView,
  type MissedView,
  type TeamAlert,
} from "@cds/db";
import { Badge, EmptyState, InlineAlert, TabLinks } from "@cds/ui/hub";
import { ScreenHeader } from "@cds/ui/hub/shell";
import { Mail, MessageSquare, Phone } from "lucide-react";
import type { Metadata } from "next";
import {
  bookingStatusAction,
  galleryPhotoAction,
  remindAlertAction,
} from "../../../actions/studio";
import { bellKeysFrom } from "../../../../lib/bell";
import { getNeedsYou } from "../../../../lib/needs-you";
import { requireHubSession } from "../../../../lib/session";
import { readStudioNote } from "../../../../lib/studio";
import { ClearAppBadge } from "../app-badge";
import { GuardedLink } from "../GuardedLink";
import { ALL_NEEDS_YOU_FAILED } from "../nav";
import { alertActions, type ContactLink } from "./alert-actions";
import { DecideButton } from "./DecideButton";

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

function Decide({
  id,
  to,
  label,
  busyLabel,
}: {
  id: string;
  to: string;
  label: string;
  busyLabel: string;
}) {
  return (
    <form action={bookingStatusAction}>
      <input type="hidden" name="bookingId" value={id} />
      <input type="hidden" name="status" value={to} />
      <input type="hidden" name="back" value="/hub/alerts" />
      <DecideButton to={to} label={label} busyLabel={busyLabel} />
    </form>
  );
}

const OFFER_STATUS = {
  pending: "Waiting for you",
  added: "Added to the Gallery",
  skipped: "Skipped",
} as const;

function GalleryDecide({
  seatId,
  mediaId,
}: {
  seatId: string;
  mediaId: string;
}) {
  return (
    <>
      {(["add", "skip"] as const).map((d) => (
        <form key={d} action={galleryPhotoAction}>
          <input type="hidden" name="seatId" value={seatId} />
          <input type="hidden" name="mediaId" value={mediaId} />
          <input type="hidden" name="decision" value={d} />
          <DecideButton
            to={d === "add" ? "confirmed" : "skipped"}
            label={d === "add" ? "Add to Gallery" : "Skip"}
            busyLabel={d === "add" ? "Adding…" : "Skipping…"}
          />
        </form>
      ))}
    </>
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

function TeamList({ rows, tz }: { rows: TeamAlert[]; tz: string }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        heading="No team alerts"
        body="Alerts sent to your barbers show here."
      />
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((a) => (
        <li
          key={a.id}
          className="flex flex-col gap-1 rounded border border-hub-border bg-hub-surface p-4"
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="min-w-0 flex-1 text-base font-semibold">{a.title}</p>
            <Badge tone={a.read ? "draft" : "unread"}>
              {a.read ? "Seen" : "Not seen yet"}
            </Badge>
          </div>
          <p className="text-sm text-hub-ink-muted">
            To {a.recipient} · {whenOf(a.createdAt, tz)}
          </p>
          {a.read ? null : (
            <form action={remindAlertAction} className="pt-2">
              <input type="hidden" name="alertId" value={a.id} />
              <button type="submit" className={LINK}>
                Send reminder
              </button>
            </form>
          )}
        </li>
      ))}
    </ul>
  );
}

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { ctx } = await requireHubSession();
  // A&M fork: owners and admins get two tabs: their own alerts and their barbers' (Team).
  const manager = ctx.role === "owner" || ctx.role === "admin";
  const team = manager && (await searchParams).tab === "team";
  const teamRows = team
    ? await listTeamAlerts(ctx).catch(() => [] as TeamAlert[])
    : [];
  const [{ rows, tz, failed }, bookings, missed, note] = await Promise.all([
    loadAlerts(ctx),
    // Only the bookings this person may see (a barber their own); none without the add-on.
    listBookings(ctx)
      .then((r) => r.bookings)
      .catch(() => [] as BookingView[]),
    listMissedBookings(ctx).catch(() => [] as MissedView[]),
    readStudioNote(),
  ]);
  const byId = new Map(bookings.map((b) => [b.id, b]));
  const missedById = new Map(missed.map((m) => [m.id, m]));
  // Seen here = read: the bell count clears (rows above keep their "New" for this view).
  if (!team && !failed && rows.some((a) => !a.read)) {
    await markAllRead(ctx).catch((err: unknown) =>
      console.error(
        `[alerts] mark read failed ${err instanceof Error ? err.name : typeof err}`,
      ),
    );
  }

  return (
    <div className="flex w-full max-w-[720px] flex-col gap-6 font-hub text-hub-ink">
      <ClearAppBadge />
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
      {manager ? (
        <TabLinks
          label="Alerts"
          activeId={team ? "team" : "mine"}
          tabs={[
            { id: "mine", label: "My alerts", href: "/hub/alerts" },
            { id: "team", label: "Team alerts", href: "/hub/alerts?tab=team" },
          ]}
        />
      ) : null}
      {team ? (
        <TeamList rows={teamRows} tz={tz} />
      ) : failed ? (
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
            const act = alertActions(a.sourceKey, byId, missedById);
            const b = act.booking;
            const offer = galleryOfferOf(a.sourceKey);
            const status = b
              ? STATUS[b.status]
              : offer
                ? OFFER_STATUS[offer.state]
                : undefined;
            const waiting = b
              ? b.status === "requested"
              : offer?.state === "pending";
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
                    <Badge tone={waiting ? "waiting" : "draft"}>{status}</Badge>
                  ) : null}
                </div>
                <p className="text-sm text-hub-ink-muted">
                  {whenOf(a.createdAt, tz)}
                  {act.client
                    ? ` · ${act.client.name}${act.client.phone ? ` · ${act.client.phone}` : ""}`
                    : ""}
                </p>
                {b?.note ? <p className="text-sm">“{b.note}”</p> : null}
                {offer ? (
                  // eslint-disable-next-line @next/next/no-img-element -- private hub route
                  <img
                    src={`/hub/api/studio/photo/${offer.seatId}/${offer.mediaId}`}
                    alt="The new photo"
                    className="h-32 w-32 rounded border border-hub-border object-cover"
                  />
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {act.decide && b ? (
                    <>
                      <Decide
                        id={b.id}
                        to="confirmed"
                        label="Approve"
                        busyLabel="Approving…"
                      />
                      <Decide
                        id={b.id}
                        to="declined"
                        label="Decline"
                        busyLabel="Declining…"
                      />
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
                  {offer?.state === "pending" && isStudioManager(ctx) ? (
                    <GalleryDecide
                      seatId={offer.seatId}
                      mediaId={offer.mediaId}
                    />
                  ) : null}
                  {!act.client && a.href && a.href !== "/hub/alerts" ? (
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

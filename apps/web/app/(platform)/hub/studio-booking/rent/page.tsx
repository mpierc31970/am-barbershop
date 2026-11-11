// /hub/studio-booking/rent: chair rent. The owner (and Admins) see every chair renter's
// lease, set rent, cadence and due date, and log payments by hand (Mark paid; no payment
// processor). A barber sees their own lease and payment log, read-only.
import { getLease, listLeases, mySeatId, type LeaseView } from "@cds/db";
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
import {
  markPaidAction,
  saveLeaseAction,
  undoPaymentAction,
} from "../../../../actions/studio";
import { requireHubSession } from "../../../../../lib/session";
import { money, priceField, readStudioNote } from "../../../../../lib/studio";
import { GuardedLink } from "../../GuardedLink";
import { StudioTabs } from "../StudioTabs";

export const metadata: Metadata = { title: "Rent" };
export const dynamic = "force-dynamic";

const CADENCE = [
  { value: "weekly", label: "Every week" },
  { value: "biweekly", label: "Every two weeks" },
  { value: "monthly", label: "Every month" },
];
const CADENCE_WORD: Record<string, string> = {
  weekly: "a week",
  biweekly: "every two weeks",
  monthly: "a month",
};
const CARD =
  "flex flex-col gap-4 rounded border border-hub-border bg-hub-surface p-4";

function day(d: string): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${d}T12:00:00Z`));
}

function Status({ lease }: { lease: LeaseView }) {
  if (!lease.active) return <Badge tone="draft">Paused</Badge>;
  if (lease.daysLate > 0) {
    return (
      <Badge tone="needed">
        {lease.daysLate} day{lease.daysLate === 1 ? "" : "s"} late
      </Badge>
    );
  }
  return <Badge tone="done">Up to date</Badge>;
}

function Payments({ lease, manager }: { lease: LeaseView; manager: boolean }) {
  if (lease.payments.length === 0) {
    return <p className="text-hub-ink-muted">No payments logged yet.</p>;
  }
  return (
    <ul className="divide-y divide-hub-border text-sm">
      {lease.payments.slice(0, 12).map((p, i) => (
        <li key={p.id} className="flex flex-wrap items-center gap-3 py-2">
          <span className="tabular-nums font-semibold">
            {money(p.amountCents)}
          </span>
          <span>
            for {day(p.periodDue)}, paid {day(p.paidOn)}
            {p.note ? ` · ${p.note}` : ""}
          </span>
          {manager && i === 0 ? (
            <form action={undoPaymentAction}>
              <input type="hidden" name="seatId" value={lease.seatId} />
              <input type="hidden" name="paymentId" value={p.id} />
              <Button type="submit" size="sm" variant="ghost">
                Undo
              </Button>
            </form>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export default async function RentPage() {
  const { ctx } = await requireHubSession();
  const manager = ctx.role === "owner" || ctx.role === "admin";
  const note = await readStudioNote();

  if (!manager) {
    const seatId = await mySeatId(ctx);
    const lease = seatId ? await getLease(ctx, seatId) : null;
    return (
      <div className="flex w-full max-w-[880px] flex-col gap-8 font-hub text-hub-ink">
        <ScreenHeader
          title="My rent"
          helpId="addon-studio-booking"
          LinkComponent={GuardedLink}
        />
        <StudioTabs active="rent" manager={false} />
        {!lease ? (
          <EmptyState
            heading="No chair rent set"
            body="The shop owner sets your rent here."
          />
        ) : (
          <div className={CARD}>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-lg font-semibold">
                {money(lease.rentCents)} {CADENCE_WORD[lease.cadence]}
              </span>
              <Status lease={lease} />
            </div>
            <p>Next due: {day(lease.nextDue)}</p>
            <Payments lease={lease} manager={false} />
          </div>
        )}
      </div>
    );
  }

  const rows = await listLeases(ctx);
  // The shop's date (America/Chicago, the A&M business time zone) for the form defaults.
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
  }).format(new Date());
  return (
    <div className="flex w-full max-w-[880px] flex-col gap-8 font-hub text-hub-ink">
      <ScreenHeader
        title="Rent"
        helpId="addon-studio-booking"
        LinkComponent={GuardedLink}
      />
      <StudioTabs active="rent" manager />
      {note ? (
        <InlineAlert tone={note.tone === "success" ? "success" : "error"}>
          {note.text}
        </InlineAlert>
      ) : null}
      {rows.some((r) => r.lease && r.lease.daysLate > 0) ? (
        <InlineAlert tone="warning">
          {rows
            .filter((r) => r.lease && r.lease.daysLate > 0)
            .map((r) => `${r.seatName} (${r.lease!.daysLate} days)`)
            .join(", ")}{" "}
          {rows.filter((r) => r.lease && r.lease.daysLate > 0).length === 1
            ? "is"
            : "are"}{" "}
          late on rent.
        </InlineAlert>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState
          heading="No chair renters"
          body="Barbers whose seat is a chair renter show here. Employees don't pay rent."
        />
      ) : (
        rows.map(({ seatId, seatName, lease }) => (
          <section key={seatId} aria-label={seatName} className={CARD}>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-semibold">{seatName}</h2>
              {lease ? (
                <Status lease={lease} />
              ) : (
                <Badge tone="optional">No rent set</Badge>
              )}
              {lease ? (
                <span className="text-hub-ink-muted">
                  {money(lease.rentCents)} {CADENCE_WORD[lease.cadence]} · next
                  due {day(lease.nextDue)}
                </span>
              ) : null}
            </div>
            {lease && lease.active ? (
              <form
                action={markPaidAction}
                className="flex flex-wrap items-end gap-3"
              >
                <input type="hidden" name="seatId" value={seatId} />
                <TextField
                  id={`amt-${seatId}`}
                  name="amount"
                  label="Amount ($)"
                  inputMode="decimal"
                  defaultValue={priceField(lease.rentCents)}
                />
                <TextField
                  id={`on-${seatId}`}
                  name="paidOn"
                  type="date"
                  label="Paid on"
                  defaultValue={today}
                />
                <TextField
                  id={`n-${seatId}`}
                  name="note"
                  label="Note (optional)"
                  maxLength={120}
                />
                <Button type="submit" variant="primary">
                  Mark {day(lease.nextDue)} paid
                </Button>
              </form>
            ) : null}
            {lease ? <Payments lease={lease} manager /> : null}
            <details>
              <summary className="cursor-pointer py-1 underline">
                {lease ? "Change rent" : "Set rent"}
              </summary>
              <form
                action={saveLeaseAction}
                className="mt-3 grid gap-3 sm:grid-cols-4"
              >
                <input type="hidden" name="seatId" value={seatId} />
                <TextField
                  id={`r-${seatId}`}
                  name="rent"
                  label="Rent ($)"
                  inputMode="decimal"
                  required
                  defaultValue={lease ? priceField(lease.rentCents) : ""}
                />
                <Select
                  id={`c-${seatId}`}
                  name="cadence"
                  label="How often"
                  options={CADENCE}
                  defaultValue={lease?.cadence ?? "weekly"}
                />
                <TextField
                  id={`d-${seatId}`}
                  name="nextDue"
                  type="date"
                  label="Next due"
                  required
                  defaultValue={lease?.nextDue ?? today}
                />
                <label className="flex items-end gap-2 pb-2">
                  <input
                    type="checkbox"
                    name="active"
                    defaultChecked={lease?.active ?? true}
                    className="h-5 w-5"
                  />
                  Collecting
                </label>
                <div className="sm:col-span-4">
                  <Button type="submit">Save rent</Button>
                </div>
              </form>
            </details>
          </section>
        ))
      )}
    </div>
  );
}

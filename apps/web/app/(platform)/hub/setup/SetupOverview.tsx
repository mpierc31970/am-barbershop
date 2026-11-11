"use client";
// Setup overview island (06-18; 06-UI-SPEC "Setup overview"; ONB-02, ONB-03, D312,
// CONTEXT A3-Q4, A1-Q5, D-UI-P6-17, D-UI-P6-32). Operate mode; the focal point is the
// "What's still needed" panel and its one primary action.
//   - Header: Display "Set up your site" + In review / Sent to CDS badge; the HELD alert
//     sits at the very top in fit_review (editing is never blocked); the first-visit welcome
//     shows until the owner opens a step.
//   - Progress "N of 7 steps done" with a 4px success bar (role=progressbar), then the seven
//     steps as an <ol>: status icon with a hidden word, name link, summary, badge, chevron.
//   - Panel (360px sticky at 1024px and up; first below): StillNeededList, footer = Continue
//     setup (must-haves missing) / Send to CDS (owner only; disabled with the reason for
//     others and for staff impersonating) / the Sent state. Send has no dialog: it is not
//     destructive, and editing continues after it.
//   - Being built (08-09; 08-UI-SPEC "Setup overview changes"; D-UI-P8-23..25, CONTEXT
//     A2-Q5): the neutral Being built badge replaces Sent to CDS, and the panel footer is the
//     status line with the preview link (new tab, noopener) plus STATUS-HELPER; no primary
//     button. No preview address: the line shows alone, never a dead link. While the stage is
//     still ready_for_build (queued, running or failed) the P6 Sent state shows unchanged.
//   - Agreement (09-19; 09-UI-SPEC "Setup item"; AGR-02, CONTEXT A2-Q5, D-UI-P9-4): from
//     Send to CDS until signed, a required row "Review and sign your agreement". The Owner
//     gets the panel's one primary action, Review and sign -> /hub/agreement, and the Sent
//     line moves under it as muted text; Admin and staff impersonating see the row with the
//     owner-only line. Signed: a done row with the date and Settings › Legal. Outdated (only
//     non-owners reach this screen then): "Updated terms waiting". Before Send to CDS
//     data.agreement is null and nothing shows.
//   - Checkout (10-22; 10-UI-SPEC "Setup item"; BILL-01, AGR-02): from Send to CDS until paid,
//     a required row "Pay and start your build" after the agreement row. Once the agreement
//     is current, the signed Owner's one primary becomes Go to checkout -> /hub/checkout.
//     Paid: a done row "Paid on {date}" + Settings › Billing. The rule is checkoutSetupItem.
import {
  Badge,
  Button,
  InlineAlert,
  StageStatusIcon,
  StillNeededList,
  buttonClasses,
  useToast,
} from "@cds/ui/hub";
import { ScreenHeader } from "@cds/ui/hub/shell";
import { ChevronRight, ExternalLink, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AgreementSetupItem } from "../../../../lib/agreement-setup";
import {
  BILLING_HREF,
  CHECKOUT_HREF,
  CHECKOUT_ITEM_TITLE,
  checkoutCountsAsRequired,
  type CheckoutSetupItem,
} from "../../../../lib/checkout-setup";
import type { StageData, StageRow } from "../../../../lib/intake";
import { sendToCdsAction } from "../../../actions/intake";
import { GuardedLink } from "../GuardedLink";

export const SETUP_INTRO =
  "Tell us about your business, in as many sittings as you like. Everything saves as you go. When the must-haves are in, send it to Support and we start building.";
export const HELD_COPY =
  "We're checking a couple of details about your business, usually within 2 business days. Keep setting up your site in the meantime; we'll email you when it's done.";
export const UNLOCK_HINT =
  "Send to Support unlocks when the must-haves are in.";
export const NOT_OWNER_SEND = "Only the site owner can send this to Support.";
export const IMPERSONATING_SEND = "Sending to Support is the owner's step.";
export const SENT_TOAST =
  "Sent to Support. We'll email you when your site is ready to review.";
export const SEND_FAILED =
  "That didn't go through. Your answers are saved. Check your connection and try again.";
export const KEEP_EDITING =
  "You can keep editing. Support always sees your latest answers.";

export const BUILT_COPY =
  "Your site is assembled. Support is polishing it now.";
const HELPER_LEAD =
  "Services, team and hours update on your site as you change them. Your other answers were used to write your pages; to change those words, edit the pages in ";
const PAGES_LABEL = "Website › Pages";
export const STATUS_HELPER = `${HELPER_LEAD}${PAGES_LABEL}.`;

/** "28 Sep" in the business's time zone (UTC until one is set). */
export function sentDate(iso: string, timeZone: string): string {
  const d = new Date(iso);
  const parts = (tz: string) =>
    new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "short",
      timeZone: tz,
    }).formatToParts(d);
  let p: Intl.DateTimeFormatPart[];
  try {
    p = parts(timeZone || "UTC");
  } catch {
    p = parts("UTC");
  }
  const day = p.find((x) => x.type === "day")?.value ?? "";
  const month = p.find((x) => x.type === "month")?.value ?? "";
  return `${day} ${month}`;
}

export function sentCopy(iso: string, timeZone: string): string {
  return `Sent to Support on ${sentDate(iso, timeZone)}. We'll email you when your site is ready to review.`;
}

export function optionalGapCopy(n: number): string {
  return n === 1
    ? "1 optional item is empty. Support will use the default shown above, and you can add it later."
    : `${n} optional items are empty. Support will use the defaults shown above, and you can add them later.`;
}

export const AGREEMENT_TITLE = "Review and sign your agreement";
export const AGREEMENT_SUB =
  "Five short policies and one signature. About 3 minutes.";
export const AGREEMENT_NOT_OWNER =
  "Only the site owner can sign the agreement.";
export const AGREEMENT_OUTDATED =
  "The owner signs these at their next sign-in.";
const LEGAL_HREF = "/hub/settings?tab=legal";
const INLINE_LINK =
  "inline-flex items-center rounded text-sm font-semibold text-hub-accent underline underline-offset-2 hover:text-hub-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent pointer-coarse:min-h-11";

function AgreementRow({ item }: { item: NonNullable<AgreementSetupItem> }) {
  if (item.state === "signed") {
    return (
      <div className="flex items-start gap-2">
        <StageStatusIcon status="done" size={16} />
        <div className="flex flex-col gap-1">
          <p className="text-sm text-hub-ink">
            {item.signedOn
              ? `Agreement signed on ${item.signedOn}`
              : "Agreement signed"}
          </p>
          <Link href={LEGAL_HREF} className={`self-start ${INLINE_LINK}`}>
            Settings › Legal
          </Link>
        </div>
      </div>
    );
  }
  if (item.state === "outdated") {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm text-hub-ink">Your agreement</span>
          <Badge tone="update-waiting">Updated terms waiting</Badge>
        </div>
        <p className="text-sm text-hub-ink-muted">{AGREEMENT_OUTDATED}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm text-hub-ink">{AGREEMENT_TITLE}</span>
        <Badge tone="needed">Needed</Badge>
      </div>
      <p className="text-sm text-hub-ink-muted">{AGREEMENT_SUB}</p>
      {item.canSign ? null : (
        <p className="text-sm text-hub-ink-muted">{AGREEMENT_NOT_OWNER}</p>
      )}
    </div>
  );
}

function CheckoutItemRow({ item }: { item: NonNullable<CheckoutSetupItem> }) {
  if (item.state === "paid") {
    return (
      <div className="flex items-start gap-2">
        <StageStatusIcon status="done" size={16} />
        <div className="flex flex-col gap-1">
          <p className="text-sm text-hub-ink">
            {item.paidOn ? `Paid on ${item.paidOn}` : "Paid"}
          </p>
          <Link href={BILLING_HREF} className={`self-start ${INLINE_LINK}`}>
            Settings › Billing
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm text-hub-ink">{CHECKOUT_ITEM_TITLE}</span>
        <Badge tone="needed">Needed</Badge>
      </div>
      <p className="text-sm text-hub-ink-muted">{item.label}</p>
    </div>
  );
}

function rowBadge(row: StageRow) {
  if (row.required > 0) {
    return <Badge tone="needed">{row.required} needed</Badge>;
  }
  if (row.status === "done") {
    return row.optional > 0 ? (
      <Badge tone="optional">{row.optional} optional left</Badge>
    ) : (
      <Badge tone="done">Done</Badge>
    );
  }
  if (row.optional > 0) {
    return <Badge tone="optional">{row.optional} optional left</Badge>;
  }
  return null;
}

function StageList({ rows }: { rows: readonly StageRow[] }) {
  return (
    <ol className="flex flex-col">
      {rows.map((row) => (
        <li
          key={row.slug}
          className="relative flex min-h-[72px] items-center gap-4 border-b border-hub-border py-4"
        >
          <StageStatusIcon status={row.status} size={20} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Link
              href={row.href}
              className="rounded text-base font-semibold text-hub-ink after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
            >
              {row.name}
            </Link>
            <p className="truncate text-sm text-hub-ink-muted">{row.summary}</p>
          </div>
          <span className="flex shrink-0 items-center gap-2">
            {rowBadge(row)}
            <ChevronRight
              aria-hidden
              size={16}
              strokeWidth={2}
              className="text-hub-ink-muted"
            />
          </span>
        </li>
      ))}
    </ol>
  );
}

export function SetupOverview({ data }: { data: StageData }) {
  const router = useRouter();
  const toast = useToast();
  const [submittedAt, setSubmittedAt] = useState(data.submittedAt);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const held = data.stage === "fit_review";
  const building = data.stage === "being_built";
  const { required, optional } = data.needed;
  const { done, total } = data.progress;
  const firstGap = data.stages.find((s) => s.required > 0) ?? data.stages[0]!;
  const tz = data.profile.time_zone;

  async function send() {
    setSending(true);
    setSendError(null);
    // A thrown action (network drop, a deploy between load and click) must not leave the
    // button spinning (C-WR-07).
    try {
      const res = await sendToCdsAction();
      if (res.ok) {
        setSubmittedAt(res.data.submittedAt);
        toast.show({ message: SENT_TOAST });
        router.refresh();
        return;
      }
      setSendError(res.message);
    } catch {
      setSendError(SEND_FAILED);
    } finally {
      setSending(false);
    }
  }

  let footer;
  if (building) {
    footer = (
      <>
        <InlineAlert tone="success">
          <p className="text-base font-semibold">{BUILT_COPY}</p>
          {data.previewUrl ? (
            <a
              href={data.previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="See your site's preview (opens in a new tab)"
              className="mt-1 inline-flex items-center gap-1 rounded text-base font-semibold text-hub-accent underline underline-offset-2 hover:text-hub-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent pointer-coarse:min-h-11"
            >
              See your site&apos;s preview
              <ExternalLink aria-hidden size={16} strokeWidth={2} />
            </a>
          ) : null}
        </InlineAlert>
        <p className="text-sm text-hub-ink-muted">
          {HELPER_LEAD}
          <Link
            href="/hub/website?tab=pages"
            className="inline-flex items-center rounded text-hub-accent underline underline-offset-2 hover:text-hub-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent pointer-coarse:min-h-11"
          >
            {PAGES_LABEL}
          </Link>
          .
        </p>
      </>
    );
  } else if (submittedAt) {
    footer = (
      <>
        <InlineAlert tone="success">{sentCopy(submittedAt, tz)}</InlineAlert>
        <p className="text-sm text-hub-ink-muted">{KEEP_EDITING}</p>
      </>
    );
  } else if (required.length > 0) {
    footer = (
      <>
        <Link
          href={firstGap.href}
          className={`${buttonClasses("primary", "md")} w-full`}
        >
          Continue setup
        </Link>
        <p className="text-sm text-hub-ink-muted">{UNLOCK_HINT}</p>
      </>
    );
  } else {
    const reason = data.impersonating
      ? IMPERSONATING_SEND
      : !data.isOwner
        ? NOT_OWNER_SEND
        : null;
    footer = (
      <>
        {optional.length > 0 ? (
          <p className="text-sm text-hub-ink-muted">
            {optionalGapCopy(optional.length)}
          </p>
        ) : null}
        {sendError ? <InlineAlert tone="error">{sendError}</InlineAlert> : null}
        <Button
          variant="primary"
          className="w-full"
          icon={<Send aria-hidden size={16} strokeWidth={2} />}
          loading={sending}
          loadingLabel="Sending…"
          disabled={reason !== null}
          aria-describedby={reason ? "send-reason" : undefined}
          onClick={() => void send()}
        >
          Send to Support
        </Button>
        {reason ? (
          <p id="send-reason" className="text-sm text-hub-ink-muted">
            {reason}
          </p>
        ) : null}
      </>
    );
  }

  // 09-19: the Owner's one primary action becomes Review and sign while the agreement is
  // needed; the Sent line stays under it as muted text, the Being built status as before.
  const agreement = data.agreement;
  if (agreement?.state === "needed" && agreement.canSign) {
    const signLink = (
      <Link
        href="/hub/agreement"
        aria-label={AGREEMENT_TITLE}
        className={`${buttonClasses("primary", "md")} w-full`}
      >
        Review and sign
      </Link>
    );
    footer =
      !building && submittedAt ? (
        <>
          {signLink}
          <p className="text-sm text-hub-ink-muted">
            {sentCopy(submittedAt, tz)}
          </p>
          <p className="text-sm text-hub-ink-muted">{KEEP_EDITING}</p>
        </>
      ) : (
        <>
          {signLink}
          {footer}
        </>
      );
  }

  // 10-22: once the agreement is current, the signed Owner's one primary is Go to checkout;
  // the Sent line stays under it as muted text, the Being built status as before.
  const checkout = data.checkout;
  if (checkout?.state === "ready" && checkout.canPay) {
    const payLink = (
      <Link
        href={CHECKOUT_HREF}
        aria-label={CHECKOUT_ITEM_TITLE}
        className={`${buttonClasses("primary", "md")} w-full`}
      >
        Go to checkout
      </Link>
    );
    footer =
      !building && submittedAt ? (
        <>
          {payLink}
          <p className="text-sm text-hub-ink-muted">
            {sentCopy(submittedAt, tz)}
          </p>
          <p className="text-sm text-hub-ink-muted">{KEEP_EDITING}</p>
        </>
      ) : (
        <>
          {payLink}
          {footer}
        </>
      );
  }

  const extraRequired =
    agreement?.state === "needed" || checkoutCountsAsRequired(checkout);
  const extraNode =
    agreement || checkout ? (
      <div className="flex flex-col gap-2">
        {agreement ? <AgreementRow item={agreement} /> : null}
        {checkout ? <CheckoutItemRow item={checkout} /> : null}
      </div>
    ) : null;

  return (
    <div className="flex flex-col gap-6 font-hub">
      {held ? <InlineAlert tone="info">{HELD_COPY}</InlineAlert> : null}
      <header className="flex flex-col gap-4">
        <ScreenHeader
          title="Set up your site"
          helpId="setup"
          helpName="setup"
          LinkComponent={GuardedLink}
        >
          {building ? (
            <Badge tone="being-built">Being built</Badge>
          ) : held ? (
            <Badge tone="review">In review</Badge>
          ) : submittedAt ? (
            <Badge tone="sent">Sent to Support</Badge>
          ) : null}
        </ScreenHeader>
        {!data.firstVisitDismissed ? (
          <InlineAlert tone="success">
            Your account is ready. Start with <strong>Your business</strong>;
            each step takes a few minutes.
          </InlineAlert>
        ) : null}
        <p className="max-w-[68ch] text-base text-hub-ink-muted">
          {SETUP_INTRO}
        </p>
      </header>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="order-2 flex flex-col gap-4 lg:order-1">
          <div className="flex flex-col gap-2">
            <p className="text-base text-hub-ink tabular-nums">
              <strong className="font-semibold">
                {done} of {total}
              </strong>{" "}
              steps done
            </p>
            <div
              role="progressbar"
              aria-label="Setup progress"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={done}
              aria-valuetext={`${done} of ${total} steps done`}
              className="h-1 w-full overflow-hidden rounded bg-hub-border"
            >
              <div
                className="h-full bg-hub-success"
                style={{ width: `${Math.round((done / total) * 100)}%` }}
              />
            </div>
          </div>
          <StageList rows={data.stages} />
        </div>
        <div className="order-1 lg:sticky lg:top-8 lg:order-2">
          <StillNeededList
            required={required}
            optional={optional}
            footer={footer}
            LinkComponent={Link}
            extra={
              extraNode ? { node: extraNode, required: extraRequired } : null
            }
          />
        </div>
      </div>
    </div>
  );
}

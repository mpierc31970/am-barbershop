"use client";
// PaidServicePanel (12-10 choice 6; SUPPORT-03, D297, D299, BILL-19, BILL-20; 12-UI-SPEC "Paid
// service" lines 459-486, D-UI-P12-12, D-UI-P12-13). At the top of a Change request CDS marked
// as paid: CdsSurface, CdsMark 20 + "This is a paid service" + the category, PAID_RULE, then
// three options:
//   1. Do it yourself → Show me how (the category's help article; everyone with read access).
//   2. Have CDS do it → Get a quote (Owner; primary while no choice is made) / "Quote requested
//      12 Oct." / View quote (primary) + "Sent 13 Oct · $120" / "You accepted the quote …".
//   3. Use my Care hour (Care Plan with minutes left) → confirm Dialog, Not now autofocus;
//      0 minutes → "No Care minutes left in October."; no Care Plan → the option is absent and
//      the upsell line + About the Care Plan shows (Owner only).
// Admin, Editor (and Viewer) see PAID_ASK_OWNER in place of options 2 and 3 (T-12-10-01; the
// server re-checks billing:write, 12-23). The panel renders only the tenant-safe PaidService.
import {
  SUPPORT_COPY,
  paidAccepted,
  paidHelpId,
  type PaidService,
} from "@cds/core/support";
import type { OrgRole } from "@cds/core";
import { formatCents } from "@cds/core/pricing";
import { CircleCheck } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import type { HubActionResult } from "../../addon-types";
import type { HubLinkComponent } from "../../AddonCard";
import { Button, buttonClasses } from "../../Button";
import { CdsMark, CdsSurface } from "../../cds";
import { Dialog } from "../../Dialog";
import { formatDayMonth } from "../../today/copy";
import { SUPPORT_UI_COPY } from "../copy";
import { CARE_PLAN_HELP_HREF, PAID_COPY, quoteHrefFor } from "./copy";

/** This month's Care Plan time; `null` when the site is not on the Care Plan. */
export type CareUsage = {
  minutesLeft: number;
  minutesIncluded: number;
  /** "October" (business time). */
  monthLabel: string;
};

export interface PaidServicePanelProps {
  paid: PaidService;
  role: OrgRole | null;
  careUsage: CareUsage | null;
  onGetQuote: () => Promise<HubActionResult<unknown>>;
  onUseCare: () => Promise<HubActionResult<unknown>>;
  /** Opens the help article in the TrainingDrawer (a read: never changes status). */
  onShowMe: (helpId: string) => void;
  /** View quote target; default /hub/settings/quotes/<work_order>. */
  quoteHref?: string;
  aboutCareHref?: string;
  timeZone: string;
  LinkComponent?: HubLinkComponent;
}

/** Only the Owner chooses a paid option (D297). */
export function canChoosePaid(role: OrgRole | null | undefined): boolean {
  return role === "owner";
}

/**
 * D-UI-P12-12: the panel holds the view's primary (Get a quote or View quote) while the Owner
 * still has a choice to make; the page then drops Send reply to secondary.
 */
export function isPrimaryChoice(
  paid: PaidService | null | undefined,
  role: OrgRole | null | undefined,
): boolean {
  if (!paid || !canChoosePaid(role) || paidAccepted(paid)) return false;
  if (paid.work_order) return true;
  return !paid.quote_requested_at;
}

const LINK =
  "rounded text-hub-accent underline underline-offset-2 focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

function Option({
  title,
  line,
  children,
}: {
  title: string;
  line: string;
  children?: ReactNode;
}) {
  return (
    <li className="flex flex-col items-start gap-2">
      <p className="text-base font-semibold">{title}</p>
      <p className="text-sm text-hub-ink-muted">{line}</p>
      {children}
    </li>
  );
}

function DoneLine({ children }: { children: ReactNode }) {
  return (
    <p className="inline-flex items-center gap-2 rounded bg-hub-success-tint px-2 py-1 text-sm text-hub-success">
      <CircleCheck aria-hidden size={16} strokeWidth={2} />
      {children}
    </p>
  );
}

export function PaidServicePanel({
  paid,
  role,
  careUsage,
  onGetQuote,
  onUseCare,
  onShowMe,
  quoteHref,
  aboutCareHref = CARE_PLAN_HELP_HREF,
  timeZone,
  LinkComponent,
}: PaidServicePanelProps) {
  const Link = LinkComponent ?? "a";
  const headingId = useId();
  const [requesting, setRequesting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const owner = canChoosePaid(role);
  const primary = isPrimaryChoice(paid, role);
  const day = (raw: string | null | undefined) =>
    raw ? formatDayMonth(raw, timeZone) : "";
  const category = SUPPORT_COPY.PAID_CATEGORY_LABELS[paid.category];

  async function getQuote() {
    setRequesting(true);
    setError(null);
    try {
      const r = await onGetQuote();
      if (!r.ok) setError(SUPPORT_UI_COPY.ERR_SAVE);
    } catch {
      setError(SUPPORT_UI_COPY.ERR_SAVE);
    } finally {
      setRequesting(false);
    }
  }

  async function chooseCare() {
    setSaving(true);
    setError(null);
    try {
      const r = await onUseCare();
      if (r.ok) setConfirmOpen(false);
      else setError(SUPPORT_UI_COPY.ERR_SAVE);
    } catch {
      setError(SUPPORT_UI_COPY.ERR_SAVE);
    } finally {
      setSaving(false);
    }
  }

  let cdsControl: ReactNode = null;
  if (paid.accepted_at) {
    cdsControl = (
      <DoneLine>{PAID_COPY.accepted(day(paid.accepted_at))}</DoneLine>
    );
  } else if (paid.work_order) {
    cdsControl = (
      <>
        <Link
          href={quoteHref ?? quoteHrefFor(paid.work_order)}
          className={buttonClasses(primary ? "primary" : "secondary")}
        >
          {SUPPORT_UI_COPY.BUTTONS.viewQuote}
        </Link>
        <p className="text-sm text-hub-ink-muted tabular-nums">
          {PAID_COPY.sent(
            day(paid.quote_sent_at),
            typeof paid.amount_cents === "number"
              ? formatCents(paid.amount_cents)
              : "",
          )}
        </p>
      </>
    );
  } else if (paid.quote_requested_at) {
    cdsControl = (
      <p className="text-sm">
        {PAID_COPY.requested(day(paid.quote_requested_at))}
      </p>
    );
  } else {
    cdsControl = (
      <Button
        variant={primary ? "primary" : "secondary"}
        loading={requesting}
        loadingLabel={SUPPORT_UI_COPY.BUTTONS.sending}
        onClick={() => void getQuote()}
      >
        {SUPPORT_UI_COPY.BUTTONS.getQuote}
      </Button>
    );
  }

  const careChosen = !!paid.care_chosen_at;
  const quoteAccepted = !!paid.accepted_at;

  return (
    <CdsSurface
      as="section"
      padding="lg"
      aria-labelledby={headingId}
      className="flex flex-col gap-4 font-hub"
      data-paid-service=""
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <h2
          id={headingId}
          className="inline-flex items-center gap-2 text-lg leading-tight font-semibold"
        >
          <CdsMark size={20} label />
          {PAID_COPY.heading}
        </h2>
        <p className="text-sm text-hub-ink-muted">{category}</p>
      </div>
      <p className="max-w-prose text-base">{SUPPORT_UI_COPY.PAID_RULE}</p>
      <ul className="flex flex-col gap-4">
        <Option title={PAID_COPY.diyTitle} line={PAID_COPY.diyLine}>
          <Button
            variant="secondary"
            onClick={() => onShowMe(paidHelpId(paid.category))}
          >
            {SUPPORT_UI_COPY.BUTTONS.showMeHow}
          </Button>
        </Option>
        {!owner ? (
          <li>
            <p className="text-sm">{SUPPORT_UI_COPY.PAID_ASK_OWNER}</p>
          </li>
        ) : careChosen ? (
          <li>
            <DoneLine>
              {PAID_COPY.careChosen(day(paid.care_chosen_at))}
            </DoneLine>
          </li>
        ) : (
          <>
            <Option title={PAID_COPY.cdsTitle} line={PAID_COPY.cdsLine}>
              {cdsControl}
            </Option>
            {careUsage && !quoteAccepted ? (
              <Option
                title={PAID_COPY.careTitle}
                line={
                  careUsage.minutesLeft > 0
                    ? PAID_COPY.careLeft(
                        careUsage.minutesLeft,
                        careUsage.minutesIncluded,
                        careUsage.monthLabel,
                      )
                    : PAID_COPY.careNone(careUsage.monthLabel)
                }
              >
                {careUsage.minutesLeft > 0 ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setError(null);
                      setConfirmOpen(true);
                    }}
                  >
                    {SUPPORT_UI_COPY.BUTTONS.useCareHour}
                  </Button>
                ) : null}
              </Option>
            ) : null}
          </>
        )}
      </ul>
      {owner && !careUsage && !careChosen && !quoteAccepted ? (
        <p className="text-sm text-hub-ink-muted">
          {PAID_COPY.careUpsell}{" "}
          <Link href={aboutCareHref} className={LINK}>
            {PAID_COPY.aboutCare}
          </Link>
        </p>
      ) : null}
      {error && !confirmOpen ? (
        <p role="alert" className="text-sm text-hub-danger">
          {error}
        </p>
      ) : null}
      {confirmOpen && careUsage ? (
        <Dialog
          open
          onClose={() => {
            if (!saving) setConfirmOpen(false);
          }}
          title={PAID_COPY.dialogTitle}
          footer={
            <>
              <Button
                variant="primary"
                loading={saving}
                loadingLabel={PAID_COPY.saving}
                onClick={() => void chooseCare()}
              >
                {SUPPORT_UI_COPY.BUTTONS.useCareHour}
              </Button>
              <Button
                variant="secondary"
                autoFocus
                disabled={saving}
                onClick={() => setConfirmOpen(false)}
              >
                {SUPPORT_UI_COPY.BUTTONS.notNow}
              </Button>
            </>
          }
        >
          <p>
            {PAID_COPY.dialogBody(careUsage.minutesLeft, careUsage.monthLabel)}
          </p>
          {error ? (
            <p role="alert" className="mt-2 text-sm text-hub-danger">
              {error}
            </p>
          ) : null}
        </Dialog>
      ) : null}
    </CdsSurface>
  );
}

"use client";
// Settings › Billing client island (10-29; 10-UI-SPEC "Settings › Billing"; BILL-03, BILL-08,
// BILL-13, BILL-16, BILL-19; D82, D225, D299, D311, D-UI-P10-14). Composes the seven sections in
// UI-SPEC order, 32px apart, max 880px, from the server-built view (lib/billing-view.ts):
//   1 status strip · 2 Your plan · 3 What you pay for · 4 Care Plan · 5 Media storage ·
//   6 Quotes from CDS · 7 Invoices.
// Before the first payment, 2-5 are one line. A failed section shows ERR-LOAD in place.
// Purchases go through the panels' ChargeConfirmDialog with the server preview; on success the
// page data refreshes. Every Update card link is intercepted: updateCardAction returns the
// hosted card page and the browser goes there in the same tab (10-29 choice 4); without JS the
// link's route does the same. `?card=updated` shows Toast "Card updated." once.
// 11-28: the "+5 pages × n" row of What you pay for carries Remove one (PagePacksRemove).
// 14-42 (LIFE-01, D282; 14-UI-SPEC "Entry"): the last row is Leave CDS (plain row, no card):
// Body 600 + Label + secondary-danger sm "Leave CDS…" → /hub/leaving. The Billing tab is
// Owner only; under impersonation the button is aria-disabled with IMPERSONATING-LEAVE.
import { P14_COPY } from "@cds/core/dns";
import { InlineAlert, buttonClasses, useToast } from "@cds/ui/hub";
import {
  BillingStatusStrip,
  CarePlanPanel,
  INVOICE_COPY,
  InvoiceTable,
  MediaPacksPanel,
  PlanSummary,
  QUOTES_EMPTY,
  SubscriptionItemsList,
  WorkOrderCard,
  sortWorkOrders,
  type ChargePreview,
  type ChargeResult,
  type MediaPackSize,
} from "@cds/ui/hub/billing";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import type { BillingTabView } from "../../../../lib/billing-view";
import {
  buyPackAction,
  carePlanPreviewAction,
  packPreviewAction,
  removePackAction,
  setCarePlanAction,
  updateCardAction,
} from "../../../actions/billing";
import {
  BEFORE_CHECKOUT_LINE,
  BILLING_TAB,
  CARD_HREF,
  CARD_UPDATED_TOAST,
  ERR_PORTAL,
  IMPERSONATING_BILLING,
  MANAGE_ADDONS_HREF,
  PAGES_PACK_ROW,
} from "./billing-copy";
import { PagePacksRemove } from "./PagePacksRemove";

export interface BillingPanelProps {
  view: BillingTabView;
  /** Arrived back from the card page (`?card=updated`). */
  cardUpdated: boolean;
}

/** Navigate to the card page (a seam for tests; jsdom has no navigation). */
export const billingNavigation = {
  go(url: string): void {
    window.location.assign(url);
  },
};

const H2 = "text-xl leading-tight font-semibold text-hub-ink";

/** 14-42: the Leave CDS row's words (UI-SPEC "Leaving CDS (owner)" › Entry). */
export const LEAVE_ROW = Object.freeze({
  title: "Leave CDS",
  label:
    "Close your site and take your domain and data with you. There's a 30-day notice period.",
  href: "/hub/leaving",
});

/** 14-42: the last Billing row. Owner only (the tab is); off while staff view the site. */
export function LeaveCdsRow({ impersonating }: { impersonating: boolean }) {
  const cls = `${buttonClasses("secondary", "sm")} w-fit text-hub-danger`;
  return (
    <section
      aria-labelledby="billing-leave"
      data-leave-row=""
      className="flex flex-col gap-2 border-t border-hub-border pt-8"
    >
      <h2 id="billing-leave" className="text-base font-semibold text-hub-ink">
        {LEAVE_ROW.title}
      </h2>
      <p className="text-sm text-hub-ink-muted">{LEAVE_ROW.label}</p>
      {impersonating ? (
        <>
          <button
            type="button"
            aria-disabled="true"
            aria-describedby="billing-leave-imp"
            className={`${cls} cursor-not-allowed opacity-50`}
          >
            {P14_COPY.BTN_LEAVE_CDS}
          </button>
          <p id="billing-leave-imp" className="text-sm text-hub-ink-muted">
            {P14_COPY.IMPERSONATING_LEAVE}
          </p>
        </>
      ) : (
        <Link href={LEAVE_ROW.href} className={cls}>
          {P14_COPY.BTN_LEAVE_CDS}
        </Link>
      )}
    </section>
  );
}

function SectionError({ id, heading }: { id: string; heading: string }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} className={H2}>
        {heading}
      </h2>
      <InlineAlert
        tone="error"
        action={
          <Link href={BILLING_TAB} className={buttonClasses("secondary", "sm")}>
            Try again
          </Link>
        }
      >
        We couldn&apos;t load this. Check your connection and try again.
      </InlineAlert>
    </section>
  );
}

function Titled({
  id,
  heading,
  children,
}: {
  id: string;
  heading: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} className={H2}>
        {heading}
      </h2>
      {children}
    </section>
  );
}

async function previewOrThrow(
  call: () => Promise<
    { ok: true; preview: ChargePreview } | { ok: false; message: string }
  >,
): Promise<ChargePreview> {
  const res = await call();
  if (!res.ok) throw new Error(res.message);
  return res.preview;
}

export function BillingPanel({ view, cardUpdated }: BillingPanelProps) {
  const router = useRouter();
  const pathname = usePathname() ?? "/hub/settings";
  const toast = useToast();
  const toasted = useRef(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const opening = useRef(false);

  useEffect(() => {
    if (!cardUpdated || toasted.current) return;
    toasted.current = true;
    // One-time: strip ?card=updated so a reload never re-toasts.
    router.replace(`${pathname}?tab=billing`, { scroll: false });
    toast.show({ message: CARD_UPDATED_TOAST });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardUpdated]);

  /** After an applied change, reload the server view (meters, items, counts). */
  async function refreshing(p: Promise<ChargeResult>): Promise<ChargeResult> {
    const res = await p;
    if (res.ok) router.refresh();
    return res;
  }

  async function openCardPage(): Promise<void> {
    if (opening.current) return;
    opening.current = true;
    setPortalError(null);
    const res = await updateCardAction().catch(() => null);
    if (res?.ok) {
      billingNavigation.go(res.data.url);
      return;
    }
    opening.current = false;
    setPortalError(res && res.message ? res.message : ERR_PORTAL);
  }

  function onClickCapture(e: MouseEvent<HTMLDivElement>): void {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
    const a = (e.target as Element | null)?.closest?.("a");
    if (!a || a.getAttribute("href") !== CARD_HREF) return;
    e.preventDefault();
    void openCardPage();
  }

  const { status, plan, items, care, media, quotes, invoices } = view;
  const pagePacks = view.pagePacks?.ok ? view.pagePacks.data : null;

  return (
    <div
      data-billing-panel=""
      className="flex max-w-[880px] flex-col gap-8"
      onClickCapture={onClickCapture}
    >
      {view.impersonating ? (
        <InlineAlert tone="info">{IMPERSONATING_BILLING}</InlineAlert>
      ) : null}
      {portalError ? (
        <InlineAlert tone="error">{portalError}</InlineAlert>
      ) : null}

      {status.ok ? (
        <BillingStatusStrip view={status.data} />
      ) : (
        <SectionError id="billing-status" heading="Billing status" />
      )}

      {!view.paid ? (
        <p className="text-base text-hub-ink-muted">{BEFORE_CHECKOUT_LINE}</p>
      ) : (
        <>
          {plan?.ok ? (
            <PlanSummary view={plan.data} updateCardHref={CARD_HREF} />
          ) : (
            <SectionError id="billing-plan" heading="Your plan" />
          )}
          {items?.ok ? (
            <SubscriptionItemsList
              view={items.data}
              manageHref={MANAGE_ADDONS_HREF}
              rowAction={(row) =>
                row.key === PAGES_PACK_ROW && pagePacks && view.canBuy ? (
                  <PagePacksRemove
                    view={pagePacks}
                    onRemove={() => refreshing(removePackAction("pages-5"))}
                  />
                ) : null
              }
            />
          ) : (
            <SectionError id="billing-items" heading="What you pay for" />
          )}
          {care?.ok ? (
            <CarePlanPanel
              view={care.data}
              canBuy={view.canBuy}
              loadAddPreview={() => previewOrThrow(carePlanPreviewAction)}
              onAdd={(token: string) =>
                refreshing(setCarePlanAction(true, token))
              }
              onRemove={() => refreshing(setCarePlanAction(false))}
              updateCardHref={CARD_HREF}
            />
          ) : (
            <SectionError id="billing-care" heading="Care Plan" />
          )}
          <div id="storage">
            {media?.ok ? (
              <MediaPacksPanel
                view={media.data}
                canBuy={view.canBuy}
                loadPreview={(size: MediaPackSize) =>
                  previewOrThrow(() => packPreviewAction(size))
                }
                onAdd={(size: MediaPackSize, token: string) =>
                  refreshing(buyPackAction(size, token))
                }
                onRemove={(size: MediaPackSize) =>
                  refreshing(removePackAction(size))
                }
                updateCardHref={CARD_HREF}
              />
            ) : (
              <SectionError id="billing-media" heading="Media storage" />
            )}
          </div>
        </>
      )}

      {quotes.ok ? (
        <Titled id="billing-quotes" heading="Quotes from CDS">
          {quotes.data.length === 0 ? (
            <p className="text-base text-hub-ink-muted">{QUOTES_EMPTY}</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {sortWorkOrders(quotes.data).map((q) => (
                <li key={q.id}>
                  <WorkOrderCard order={q} />
                </li>
              ))}
            </ul>
          )}
        </Titled>
      ) : (
        <SectionError id="billing-quotes" heading="Quotes from CDS" />
      )}

      {invoices.ok ? (
        <Titled id="billing-invoices" heading={INVOICE_COPY.heading}>
          <InvoiceTable rows={invoices.data} />
        </Titled>
      ) : (
        <SectionError id="billing-invoices" heading={INVOICE_COPY.heading} />
      )}

      <LeaveCdsRow impersonating={view.impersonating} />
    </div>
  );
}

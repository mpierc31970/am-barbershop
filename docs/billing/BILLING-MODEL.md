# CDS billing model

The written billing spec (BILL-17, D263). It describes how CDS charges a tenant for CDS's own
services, and how that maps to Stripe objects and to platform state. Every figure is integer
cents in code; dollars here are for reading. The pure rules live in
`packages/core/src/payments/billing-model.ts`; the ports in `packages/core/src/payments/types.ts`.

## Scope and roles

- **CDS bills only its own services, on its own Stripe account** (D66, D296): the build fee,
  the monthly base platform fee, add-ons, the optional Care Plan, media packs and paid
  services. This side is the `CdsBilling` port.
- **Tenants' customers pay the tenant**, on the tenant's own Stripe Connect **Standard**
  account (D256). The tenant is the seller and pays Stripe's fees directly. CDS takes no cut:
  no input type has a platform-cut field (BILL-07, D52). This side is the `PaymentGateway`
  port.
- CDS is never a payment processor. No checkout code calls Stripe except through these two
  ports (PAY-09); the Stripe SDK is imported only under `packages/db/src/payments/stripe/`.

## The billing_accounts record

One platform record per organization. The webhook and reconcile handlers are the only
writers; every write is "set to state X", never "increment" (handlers are idempotent).

| Field                | Meaning                                                                   |
| -------------------- | ------------------------------------------------------------------------- |
| `provider`           | `stripe` or `fake` (the stand-in adapter)                                 |
| `customer_id`        | Provider customer id; created once by `ensureCustomer`                    |
| `subscription_id`    | The tenant's one subscription (D263); empty before checkout               |
| `status`             | `none` / `active` / `past_due` / `lapsed` / `canceled`                    |
| `cadence`            | `monthly` or `yearly`                                                     |
| `build_plan`         | `full` (paid at checkout) or `installments` (6 payments, D181)            |
| `installments_paid`  | Recomputed from paid invoices that carry the installment price            |
| `paid_at`            | First successful checkout payment; starts the D214 decline window         |
| `care_plan`          | Care Plan item present on the subscription (D299)                         |
| `media_5gb_qty`      | Quantity of the 5 GB media pack item (D225)                               |
| `media_25gb_qty`     | Quantity of the 25 GB media pack item (D225)                              |
| `current_period_end` | Minimum of the item periods (basil keeps periods on items)                |
| `lapsed_at`          | When the status became `lapsed`; cleared on restore                       |
| `price_locked_until` | Founding-customer rate lock end, `paid_at` + 2 years (D161)               |
| `checkout_draft`     | The re-priced lines of the open Checkout Session (reference, not a quote) |

Provider ids are platform-only and never reach the browser (BILL-05).

## Subscription items

One subscription per tenant (D263, BILL-16). Every recurring charge is an item on it. Every
price comes from one `price_catalog` row keyed by (kind, key, path) (D264).

| Item                       | Price                                   | Added                                            | Changed                                           | Prorated                           | Removed                                                   |
| -------------------------- | --------------------------------------- | ------------------------------------------------ | ------------------------------------------------- | ---------------------------------- | --------------------------------------------------------- |
| Base plan (per path)       | Standard $39/mo, Studio $49/mo (D300)   | At checkout                                      | Never in v1.0 (one path per org)                  | n/a                                | Only by cancel                                            |
| Priced add-on              | Its catalog row for the org's path      | At checkout, or later on the saved card          | Price swap via `syncPrice` affects new sales only | Yes, `always_invoice`              | Uninstall removes the item at period end, data retained   |
| Builder Pro                | $12/mo Standard; $0 on Studio (D234)    | Like any add-on; included on Studio              | n/a                                               | Yes on Standard                    | Like any add-on                                           |
| Care Plan                  | $99/mo, optional, off by default (D299) | At checkout or later from Billing                | n/a                                               | Yes                                | Owner removes; ends at period end                         |
| Media packs                | `media-5gb` $5, `media-25gb` $15 (D225) | Quantity item on the saved card                  | `setQuantity`                                     | Yes                                | Quantity to 0 removes the item; files over allowance kept |
| Build installment          | 6 x $250 / 6 x $583.33 (D181)           | At checkout when the owner picks 6 payments      | Never                                             | No (`none`)                        | After the 6th paid installment invoice, `proration: none` |
| Private add-on maintenance | Quoted per work order (BILL-20)         | `work:deliver`, after the work order is accepted | A new quote                                       | Yes                                | Uninstall by staff                                        |
| Newsletter overage         | Metered, past 10,000 emails a month     | When the Newsletter add-on ships (v1.1)          | n/a                                               | Metered, billed monthly in arrears | With the Newsletter add-on                                |

Rules for every item:

- **Add on the saved card** uses `changeItems` with `chargeNow: true`
  (`pending_if_incomplete`): the change applies only if the proration invoice is paid. A
  pending update means the card failed; nothing is installed.
- **Unset prices block checkout** for that item ("Price coming soon"); never an invented
  figure.
- **Prices are immutable.** A changed amount creates a new price; existing subscriptions keep
  their old price id.

## Booking tiers and Studio inclusions

Studio pricing (BILL-10, D179, D180, D263):

- **Studio Booking is one subscription item**, keyed `studio-booking`, on the tenant's one
  subscription. Its price is the tier row for the current staff count. It is never a second
  item and never a second subscription.
- Catalog keys on the `studio` path, seeded by plan 10-11:

  | Catalog key                 | Staff count | Price   |
  | --------------------------- | ----------- | ------- |
  | `studio-booking-solo`       | 1           | $49/mo  |
  | `studio-booking-team`       | 2-5         | $99/mo  |
  | `studio-booking-large-team` | 6+          | $179/mo |

  Every tier has the same features; only the price differs.

- **A staff count that crosses a tier boundary swaps the item's price**, prorated
  (`always_invoice`). It never adds an item.
- **Appointments** (Standard path) is a separate add-on and never shares this logic
  (D176-D178).
- **Newsletter and landing pages are `addon` rows at $0 on Studio** (D180), so
  `entitlements(ctx)` includes them with no charge (10-17 choice 1). $0 items are not "paid
  add-ons": they stay on through a lapse.
- **Newsletter overage** past 10,000 emails a month is a metered item reported with
  `reportUsage` and **billed monthly, even on yearly plans**.
- The tier-swap trigger (a staff count change) and the overage meter are wired by the Studio
  Booking and Newsletter add-ons when they ship in v1.1 (ROADMAP). v1.0 ships the catalog
  rows and the port methods.

## Cadence and the yearly two-step

- **Monthly**: one hosted Checkout Session with every recurring item monthly.
- **Yearly** = 10 x monthly ("2 months free", D180) and covers **the base plan and flat
  add-ons only**. Metered items, packs, overages and the Care Plan stay monthly (D263, D314).
- Stripe Checkout cannot create a mixed-interval subscription, so yearly is a **two-step**
  (10-01 choice 2, RESEARCH Pattern 4(a)):
  1. Checkout holds the yearly items (plan + flat add-ons at their yearly price), the one-time
     lines (build fee in full, extras), and a **one-time "first month" line** for each
     monthly-by-nature item (Care Plan, build installment 1).
  2. The `checkout.completed` handler adds the monthly items (`deferredMonthly`) to the
     subscription with `proration: none`, so their first month is not charged twice.
- All figures still come from `priceQuote()`; the owner sees one "Due today".
- **Fallback (b), documented, not built**: a monthly-only subscription, a one-time yearly
  prepay line, and a 12-month 100%-off coupon on the flat products. It conflicts with
  promotion codes on Checkout, so it is second choice.
- **Annual cancel** runs to the end of the term with **no refund**:
  `cancel_at: "max_period_end"` (`cancel_at_period_end` is deprecated for mixed-interval
  subscriptions).

## Build fee installments

- Pay in full is offered first. Six payments carry no surcharge (D181).
- `installmentSplit()` is the one formula, shared with `priceQuote`: each payment is
  `floor(total / 6)`, the remainder cents go on the 6th. Studio: 5 x $583.33 + $583.35.
- The Stripe recurring price is the `eachCents` figure. Before the 6th installment invoice,
  the handler adds a **pending invoice item** for `lastCents - eachCents` (2 cents on Studio).
- After the **6th paid installment invoice**, the handler removes the item with
  `proration: none`. `installments_paid` is recomputed from paid invoices, never counted up.
- **On cancel**, the remaining installments (with the remainder) become **one one-off
  invoice** (D181, agreement clause).

## Charges on the saved card

- **Pre-launch**: add-ons install with **no setup fee** (D186).
- **Post-launch**: a $25 `setup_fee` one-time line plus the prorated item, through
  `changeItems` with `chargeNow: true` (`pending_if_incomplete`).
- **Install only after paid**: the add-on installs when the change applies. A declined card
  returns `{ applied: false, reason: "card_declined" }` and nothing is installed.
- The confirm dialog shows `previewChange()`: today, tax, then monthly, period end.

## Webhook to state table

Every event is written to `payment_events` first (unique provider + event id), then the
handler re-fetches the object from the provider. Events are normalised to `NormalisedEvent`.

| Event                                                | billing_accounts                                       | Add-ons                                                             | Owner surfaces                                   |
| ---------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------ |
| `checkout.completed`                                 | ids, `cadence`, `build_plan`, `paid_at`, `active`      | Selected add-ons installed, `source = billing`                      | Receipt; build starts                            |
| `invoice.paid`                                       | `installments_paid` recomputed; `past_due` -> `active` | Rows disabled for `billing_lapse` re-enabled after a lapse          | `billing.restored` after a lapse                 |
| `invoice.payment_failed`                             | `past_due`                                             | **Unchanged**                                                       | Needs-you "Fix your card", `billing.card_failed` |
| `subscription.updated` (active / trialing)           | `active`                                               | As subscribed                                                       | none                                             |
| `subscription.updated` (past_due)                    | `past_due`                                             | **Unchanged** (D310)                                                | Needs-you "Fix your card"                        |
| `subscription.updated` (unpaid / incomplete_expired) | `lapsed`, `lapsed_at`                                  | Paid add-ons -> `disabled` / `billing_lapse`; nothing deleted (D27) | Owner banner, `billing.lapsed`                   |
| `subscription.deleted`                               | `lapsed` (or `canceled` after a deliberate cancel)     | As lapsed                                                           | Owner banner                                     |
| back to active                                       | `active`, `lapsed_at` cleared                          | Re-enable **only** `disabled_reason = billing_lapse` rows           | `billing.restored`                               |
| `subscription.pending_update_applied` / `_expired`   | none                                                   | Install on applied; nothing on expired                              | Card-declined copy on expired                    |
| `account.updated`                                    | n/a (`gateway_accounts` status)                        | n/a                                                                 | "Finish Stripe setup" when charges are off       |
| `account.deauthorized`                               | n/a (`gateway_accounts` -> `disconnected`)             | n/a                                                                 | Needs-you item; staff alert                      |

`lapseStateFor()` is the one status mapping: `active`/`trialing` -> active, `past_due` ->
past_due, `unpaid`/`canceled`/`incomplete_expired` -> lapsed, `incomplete` -> none.

## Discounts

All discounts are Stripe objects, never hard-coded logic (a price change is never a deploy).

- **Founding-customer 2-year rate lock** (D161): a price-id snapshot plus
  `price_locked_until`. Prices are immutable, so a later price change creates a new price and
  the founding subscription keeps its old id. No coupon needed.
- **Independent-pro offer** (D167, D168): one public **promotion code** giving 25% off the
  build fee and the first month free. Entered by the owner on the hosted Checkout page. CDS
  never applies server-side coupons at checkout, because promotion codes and discounts cannot
  both be set on one Checkout Session (Pitfall 9).
- **Tenant print discount** (D207): amount undecided (TBD). Nothing is built.

## Tax

- Stripe Tax on CDS's own account, automatic tax on with billing address collected (BILL-15,
  D262).
- Tax shows **$0 until CDS registers** in a jurisdiction (Pitfall 10). That is correct, not a
  bug. The UI shows the invoice's actual tax.
- The fake adapter shows "Tax calculated at payment" and charges none.

## Metered usage

- Usage is reported with `reportUsage` (Stripe Billing Meters: event name, customer, value,
  idempotent identifier). Legacy usage records are not used.
- Meters are billed monthly in arrears on every cadence.
- Newsletter overage and chatbot usage report through it when those add-ons ship.

## Stand-in adapter

- `CDS_PAYMENTS=fake` (default in dev and tests) or `stripe` (needs `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`).
- The fake adapter keeps state in PocketBase and serves a "Test payment" page that emits the
  same normalised events through the same webhook processor.
- **Production refusal**: in `CDS_ENV=production` the fake adapter refuses to take money
  (`PaymentsUnavailable`, "Payments open soon") and staff are alerted.

## Open items

- **Texas sales tax registration** and an accountant's review before live charges (D262,
  GO-LIVE).
- **Stripe Dashboard setting**: "Manage failed payments" must **mark the subscription unpaid**
  after the last retry, not cancel it, so restoring is "pay the open invoice" (GO-LIVE).
- **Design polish hourly rate** is unset in the catalog (D297); polish quotes show "Price
  coming soon" until it is set.
- Business days exclude weekends only; public holidays are out of scope.
- **D214 decline window, exact reading (review WR-B02):** "up to 5 business days after
  payment" counts from the first business day after the payment date. A weekday payment
  has the rest of that day plus 5 business days (Fri payment: closes end of the next Fri). A
  Saturday or Sunday payment makes Monday business day 1 and closes at the end of that
  Friday, never later than a Friday payer's window. The agreement text follows this.

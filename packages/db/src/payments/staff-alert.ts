// P10 payments: one staff alert from a payment handler or job (billing.staff_alert). Internal.
// A send failure is logged, never thrown: the money path it reports on has already run.
import { CdsError } from "@cds/core";
import type PocketBase from "pocketbase";
import { ClientResponseError } from "pocketbase";
import { mintSystemContext } from "../context";
import type { EmailData } from "../email/render/templates";
import { sendEmail } from "../email/send";
import type { EmailTransport } from "../email/transport";
import { staffAlertAddress } from "../media/ops/alerts";
import { BILLING_JOB } from "./accounts";

export type BillingStaffAlertEvent = EmailData["billing.staff_alert"]["event"];

function errName(err: unknown): string {
  return err instanceof Error ? err.name : "Error";
}

/**
 * WR-A01: a provider id (customer, subscription, Connect account, invoice) already belongs
 * to another org. A hard refusal: nothing was written for this org.
 */
export class ProviderIdConflict extends CdsError {
  override readonly code = "provider_id_conflict";
  constructor() {
    super(
      "This payment account is linked to another site. Support has been told and will sort it out.",
    );
  }
}

/** A PocketBase write refused by a unique index (also inside a batch). */
export function isUniqueViolation(err: unknown): boolean {
  if (!(err instanceof ClientResponseError) || err.status !== 400) return false;
  try {
    return JSON.stringify(err.response ?? {}).includes("validation_not_unique");
  } catch {
    return false;
  }
}

/**
 * Run a write that sets a provider id. A unique-index refusal (the id belongs to another
 * org, WR-A01) alerts staff and throws ProviderIdConflict; anything else rethrows.
 */
export async function guardProviderIdWrite<T>(
  pb: PocketBase,
  orgId: string,
  what: string,
  write: () => Promise<T>,
  transport?: EmailTransport,
): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    console.error(`[payments] org ${orgId}: ${what} belongs to another org`);
    await billingStaffAlert(
      pb,
      "provider_id_conflict",
      orgId,
      `Refused: the ${what} the payment provider returned is already stored on another org. Nothing was written for this org. Check both orgs' billing rows before any retry.`,
      transport,
    );
    throw new ProviderIdConflict();
  }
}

/** Send one staff alert naming the org (its name read best-effort). */
export async function billingStaffAlert(
  pb: PocketBase | null,
  event: BillingStaffAlertEvent,
  orgId: string,
  detail: string,
  transport?: EmailTransport,
): Promise<void> {
  const to = staffAlertAddress();
  if (!to) {
    console.warn(`[payments] ${event}: no staff alert address (org ${orgId})`);
    return;
  }
  let orgName = orgId;
  if (pb) {
    try {
      const org = await pb
        .collection("organizations")
        .getOne(orgId, { fields: "id,name" });
      if (typeof org.name === "string" && org.name !== "") orgName = org.name;
    } catch {
      // The id is enough for staff to act on.
    }
  }
  try {
    await sendEmail(
      { kind: "cds", ctx: mintSystemContext({ job: BILLING_JOB }) },
      "billing.staff_alert",
      to,
      { event, orgName, orgId, detail },
      transport ? { transport } : {},
    );
  } catch (err) {
    console.error(
      `[payments] staff alert ${event} for org ${orgId} not sent: ${errName(err)}`,
    );
  }
}

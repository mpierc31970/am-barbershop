"use server";
// Hub /contact (15-19; HUB-07, HUB-03; A3-Q2; T-15-19-01..05). Anonymous: no session. Field
// checks here (lib/contact-form validateContact) give inline errors; then createHubInquiry runs
// the gates itself, in the report.ts order (WR-B07): the per-IP limiter (5/hour, RateLimited),
// the Turnstile check (InvalidInput with the bot copy), then the write (hub_inquiries row + one
// logged-not-sent staff email, never mail to the visitor). The phone is dropped unless the topic is `call` (validateContact).
// Logging is class names only: never the name, email, message or IP.
import { InvalidInput, RateLimited } from "@cds/core";
import { MK_COPY } from "@cds/core/marketing";
import { createHubInquiry } from "@cds/db";
import {
  CONTACT_TOKEN_MAX,
  contactValuesFrom,
  validateContact,
  type ContactFieldErrors,
  type ContactState,
  type ContactValues,
} from "../../lib/contact-form";
import { clientIp } from "../../lib/session";

function logFailure(err: unknown): void {
  console.error(
    `[contact] submit failed ${err instanceof Error ? err.name : typeof err}`,
  );
}

function idle(
  values: ContactValues,
  error: string | null,
  fieldErrors: ContactFieldErrors = {},
): ContactState {
  return { status: "idle", error, fieldErrors, values };
}

export async function submitContactAction(
  _prev: ContactState,
  formData: FormData,
): Promise<ContactState> {
  const values = contactValuesFrom(formData);
  try {
    const { fieldErrors, contact } = validateContact(values);
    if (!contact) return idle(values, null, fieldErrors);

    const ip = await clientIp();
    const raw = formData.get("cf-turnstile-response");
    const humanToken =
      typeof raw === "string" ? raw.trim().slice(0, CONTACT_TOKEN_MAX + 1) : "";

    // Rate limit and Turnstile are checked inside (RateLimited / InvalidInput).
    await createHubInquiry({ ...contact, ip, humanToken });
    return {
      status: "sent",
      email: contact.email,
      isCall: contact.topic === "call",
    };
  } catch (err) {
    if (err instanceof RateLimited)
      return idle(values, MK_COPY.CONTACT.ERR_RATE);
    if (err instanceof InvalidInput) return idle(values, err.message);
    logFailure(err);
    return idle(values, MK_COPY.CONTACT.ERR_SERVER);
  }
}

// Hub /contact inquiries (15-03; HUB-07, HUB-03; P15-P14, A3-Q2). The platform collection
// `hub_inquiries` (no organization field, every API rule null) replaces the archived site's
// contact and booking-request flow.
//
// - createHubInquiry: anonymous write under a system context, gated inside the function
//   (WR-B07) so no caller can skip a gate: every field is validated again (InvalidInput), then
//   the per-IP contact slot is taken (beginContactAction, RateLimited), then the Turnstile token
//   is verified (InvalidInput with the bot copy). The IP is never stored, nor anything derived
//   from it (WR-B06: an unsalted IPv4 hash is reversible, and the 5-per-hour limit is in
//   memory). Then one `hub.inquiry` email goes to staffAlertAddress() only, sent as CDS with the visitor's address as Reply-To, never as a recipient
//   (T-15-03-03). Email is the logged stand-in until SES (GO-LIVE). A send failure never loses
//   the stored inquiry; it is logged by class name only.
// - listHubInquiries: staff read (leads_list: super_admin, support_agent), newest first, bound
//   filter params only (T-15-03-05). Returns contact facts, never the message.
// - pruneHubInquiries: rows older than HUB_INQUIRY_RETENTION_DAYS are deleted (dry run counts).
//   Context-free, so internal (WR-B07): only jobs/retention.ts imports it, by relative path;
//   the @cds/db barrel does not export it.
import { authorizeStaff, InvalidInput } from "@cds/core";
import { isEmail, normaliseEmail } from "@cds/core/email";
import { MK_COPY } from "@cds/core/marketing";
import { withSuperuser } from "./client";
import {
  assertPlatformContext,
  mintSystemContext,
  type PlatformContext,
} from "./context";
import { sendEmail } from "./email/send";
import type { EmailTransport } from "./email/transport";
import { getHumanCheck, type HumanCheck } from "./human-check";
import { staffAlertAddress } from "./media/ops/alerts";
import { beginContactAction } from "./rate-limit";

const COLLECTION = "hub_inquiries";
const DAY_MS = 86_400_000;

/** The /contact topics (migration 1790000900 select values). */
export const HUB_INQUIRY_TOPICS = ["question", "call", "press"] as const;
export type HubInquiryTopic = (typeof HUB_INQUIRY_TOPICS)[number];

/** Staff-facing topic words (email subject and facts). */
const TOPIC_LABELS: Record<HubInquiryTopic, string> = {
  question: "Question",
  call: "Book a call",
  press: "Press",
};

/** Kept two years, then deleted by the retention job (P15-P14). */
export const HUB_INQUIRY_RETENTION_DAYS = 730;

/** Field caps (migration 1790000900). */
export const HUB_INQUIRY_LIMITS = {
  name: 100,
  email: 254,
  business: 120,
  phone: 40,
  about: 60,
  message: 2000,
} as const;

export type HubInquiryInput = {
  name: string;
  email: string;
  business?: string;
  topic: HubInquiryTopic;
  phone?: string;
  about?: string;
  message: string;
  /** The client IP: the rate-limit key and the Turnstile remoteip; never stored (WR-B06). */
  ip: string;
  /** The Turnstile response token from the form (cf-turnstile-response). */
  humanToken: string;
};

export type HubInquiryDeps = {
  transport?: EmailTransport;
  send?: typeof sendEmail;
  /** Test seam only; production uses the configured Turnstile check (getHumanCheck). */
  humanCheck?: HumanCheck;
};

export type HubInquiryRow = {
  id: string;
  created: string;
  name: string;
  email: string;
  business: string;
  topic: HubInquiryTopic;
  about: string;
};

function isTopic(v: unknown): v is HubInquiryTopic {
  return (
    typeof v === "string" &&
    (HUB_INQUIRY_TOPICS as readonly string[]).includes(v)
  );
}

function text(
  v: unknown,
  field: keyof typeof HUB_INQUIRY_LIMITS,
  required: boolean,
): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (required && s === "") throw new InvalidInput(`${field} is required`);
  if (s.length > HUB_INQUIRY_LIMITS[field]) {
    throw new InvalidInput(`${field} is too long`);
  }
  // Single-line fields carry no line breaks (subject and facts lines).
  if (field !== "message" && /[\r\n]/.test(s)) {
    throw new InvalidInput(`${field} must be one line`);
  }
  return s;
}

/** Validate and normalise one inquiry; throws InvalidInput naming the field (never the value). */
export function validateHubInquiry(
  input: Omit<HubInquiryInput, "ip" | "humanToken">,
): Omit<HubInquiryInput, "ip" | "humanToken"> & {
  business: string;
  phone: string;
  about: string;
} {
  if (typeof input !== "object" || input === null) {
    throw new InvalidInput("inquiry is required");
  }
  const name = text(input.name, "name", true);
  const rawEmail = text(input.email, "email", true).toLowerCase();
  if (!isEmail(rawEmail)) throw new InvalidInput("email is not valid");
  if (!isTopic(input.topic)) throw new InvalidInput("topic is not valid");
  return {
    name,
    email: normaliseEmail(rawEmail),
    business: text(input.business, "business", false),
    topic: input.topic,
    phone: text(input.phone, "phone", false),
    about: text(input.about, "about", false),
    message: text(input.message, "message", true),
  };
}

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

/**
 * Store one /contact inquiry and queue the staff copy. Order (report.ts order, WR-B07): fields
 * (InvalidInput), the per-IP contact slot (RateLimited), the Turnstile check (InvalidInput
 * with MK_COPY.CONTACT.ERR_TURNSTILE), then the write. The gates live here, so a second
 * caller cannot skip either.
 */
export async function createHubInquiry(
  input: HubInquiryInput,
  deps: HubInquiryDeps = {},
): Promise<{ id: string; staffNotified: boolean }> {
  const v = validateHubInquiry(input);
  beginContactAction(input.ip);
  const human = deps.humanCheck ?? getHumanCheck();
  let isHuman = false;
  try {
    isHuman = await human.verify(String(input.humanToken ?? ""), input.ip);
  } catch {
    isHuman = false; // fail closed
  }
  if (!isHuman) throw new InvalidInput(MK_COPY.CONTACT.ERR_TURNSTILE);
  const ctx = mintSystemContext({ job: "hub-contact" });
  const id = await withSuperuser(async (pb) => {
    const row = await pb.collection(COLLECTION).create({
      name: v.name,
      email: v.email,
      business: v.business,
      topic: v.topic,
      phone: v.phone,
      about: v.about,
      message: v.message,
    });
    return String(row.id);
  });

  const to = staffAlertAddress();
  if (!to) {
    console.warn("[hub-contact] staff copy not sent: no staff address");
    return { id, staffNotified: false };
  }
  try {
    const r = await (deps.send ?? sendEmail)(
      { kind: "cds", ctx },
      "hub.inquiry",
      to,
      {
        name: v.name,
        email: v.email,
        business: v.business,
        topicLabel: TOPIC_LABELS[v.topic],
        phone: v.phone,
        about: v.about,
        message: v.message,
      },
      {
        replyTo: v.email,
        ...(deps.transport ? { transport: deps.transport } : {}),
      },
    );
    return { id, staffNotified: r.status === "sent" };
  } catch (err) {
    console.error(`[hub-contact] staff copy failed ${errName(err)}`);
    return { id, staffNotified: false };
  }
}

/** Staff list (leads_list), newest first; never the message or the IP bucket. */
export async function listHubInquiries(
  ctx: PlatformContext,
  opts: { since?: Date } = {},
): Promise<HubInquiryRow[]> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "leads_list");
  const since =
    opts.since instanceof Date && !Number.isNaN(opts.since.getTime())
      ? opts.since
      : null;
  return withSuperuser(async (pb) => {
    const rows = await pb.collection(COLLECTION).getFullList({
      ...(since ? { filter: pb.filter("created >= {:since}", { since }) } : {}),
      sort: "-created,-id",
      fields: "id,created,name,email,business,topic,about",
    });
    return rows.map((r) => ({
      id: String(r.id),
      created: String(r.created ?? ""),
      name: String(r.name ?? ""),
      email: String(r.email ?? ""),
      business: String(r.business ?? ""),
      topic: isTopic(r.topic) ? r.topic : "question",
      about: String(r.about ?? ""),
    }));
  });
}

/** Delete inquiries older than HUB_INQUIRY_RETENTION_DAYS; a dry run only counts them. */
export async function pruneHubInquiries(
  now: Date,
  opts: { dryRun: boolean },
): Promise<{ deleted: number }> {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new InvalidInput("now must be a valid date");
  }
  const cut = new Date(now.getTime() - HUB_INQUIRY_RETENTION_DAYS * DAY_MS);
  return withSuperuser(async (pb) => {
    const rows = await pb.collection(COLLECTION).getFullList({
      filter: pb.filter("created < {:cut}", { cut }),
      fields: "id",
    });
    if (opts.dryRun) return { deleted: rows.length };
    let deleted = 0;
    for (const r of rows) {
      await pb.collection(COLLECTION).delete(String(r.id));
      deleted += 1;
    }
    return { deleted };
  });
}

// The one send path (EMAIL-01, ONB-10, D114, D132, D138, D173, D267; CONTEXT A5-Q1/Q3).
// Order is fixed: registered type -> pre-launch hold (11-10, DASH-32) -> demo drop (13-24,
// D293) -> suppression list -> sender identity -> render -> transport.
// An unregistered type never reaches the transport; marketing mail always carries RFC 8058
// List-Unsubscribe + List-Unsubscribe-Post headers.
import { CdsError, InvalidInput, NotFound } from "@cds/core";
import {
  composeEmailTypes,
  headerValue,
  isEmail,
  lookupEmailType,
  normaliseEmail,
  senderFor,
  type EmailTypeRegistry,
  type SenderIdentity,
} from "@cds/core/email";
import { withSuperuser } from "../client";
import { orgIsDemo } from "../demo/flag";
import { orgIsLive } from "../org-stage";
import { mailDomain, supportEmail } from "./env";
import { safeHref } from "./render/layout";
import { hasTemplate, renderEmail, type EmailData } from "./render/templates";
import { canSend, senderOrgKey, type SendAs } from "./suppressions";
import {
  getEmailTransport,
  type EmailTransport,
  type RenderedEmail,
} from "./transport";

export type SendResult =
  | { status: "sent" }
  | { status: "suppressed" }
  /** Marketing mail sent as an org before it is live (DASH-32): not written to the outbox. */
  | { status: "held" }
  /** Mail about the demo org (13-24, STAFF-18, D293): dropped before the transport. */
  | { status: "skipped"; reason: "demo" };

export type SendDeps = {
  transport?: EmailTransport;
  types?: EmailTypeRegistry;
  now?: Date;
  /**
   * Per-message Reply-To (07-15): the visitor's email for form notifications. Ignored unless
   * a valid address (normaliseEmail refuses CR/LF, so no header injection); never throws.
   * A list (Studio Booking: the owner and the barber) keeps its valid addresses, joined.
   */
  replyTo?: string | readonly string[];
  /**
   * P13 (13-02): the org a CDS-identity mail is about (suspension, report notice, support
   * notices). 13-24: mail about the demo org is dropped (STAFF-18, D293).
   */
  concernsOrg?: string;
};

/** The transport refused the message; the cause is kept, the address is not in the message. */
export class EmailSendFailed extends CdsError {
  override readonly code = "email_send_failed";
}

let failures = 0;

/** In-process count of transport failures (monitor heartbeat, 06-09). */
export function emailSendFailures(): number {
  return failures;
}

/**
 * The org's sender identity (D112, D173). P14 (14-25, ONB-10, RESEARCH Pitfall 2): the own
 * sending domain and the owner's local part come from business_profile; senderFor uses them
 * only while the system-set `sending_domain_verified` flag is true (T-14-25-01).
 * Exported for send.test.ts; not part of the email barrel.
 */
export async function orgIdentity(orgId: string): Promise<SenderIdentity> {
  return withSuperuser(async (pb) => {
    const org = await pb
      .collection("organizations")
      .getOne(orgId, { fields: "id,name,slug" })
      .catch(() => {
        throw new NotFound();
      });
    const profile = await pb
      .collection("business_profile")
      .getFirstListItem(pb.filter("organization = {:org}", { org: orgId }), {
        fields: "sending_domain,sending_local_part,sending_domain_verified",
      })
      .catch(() => null);
    const route = await pb
      .collection("org_email_routes")
      .getFirstListItem(
        pb.filter(
          "organization = {:org} && purpose = 'default' && confirmed_at != '' && bounced_at = ''",
          { org: orgId },
        ),
        { fields: "address", sort: "-confirmed_at" },
      )
      .catch(() => null);
    const sendingDomain =
      typeof profile?.sending_domain === "string"
        ? profile.sending_domain.trim()
        : "";
    const localPart =
      typeof profile?.sending_local_part === "string"
        ? profile.sending_local_part
        : "";
    return {
      kind: "org",
      name: String(org.name ?? ""),
      slug: String(org.slug ?? ""),
      replyTo: route ? String(route.address ?? "") : "",
      // P14 (14-25): the verified own domain (written by the domains job, 14-24); senderFor
      // falls back to the platform domain when unverified, free-mail or invalid.
      ownDomain: sendingDomain || null,
      localPart,
      sendingDomainVerified: profile?.sending_domain_verified === true,
    };
  });
}

export async function sendEmail<T extends keyof EmailData>(
  as: SendAs,
  type: T,
  to: string,
  data: EmailData[T],
  deps: SendDeps = {},
): Promise<SendResult> {
  // 1. Registered type (EMAIL-01): unregistered or PocketBase-sent types stop here.
  const spec = lookupEmailType(deps.types ?? composeEmailTypes([]), type);
  if (spec.sentBy === "pb") {
    throw new InvalidInput(
      `${String(type)} is sent by the database, not the app`,
    );
  }
  if (!hasTemplate(type)) {
    throw new InvalidInput(`no template for email type ${String(type)}`);
  }
  const orgKey = senderOrgKey(as);
  const recipient = normaliseEmail(to);

  // 1b. Pre-launch hold (DASH-32, Pitfall 9): only marketing mail sent as the org waits for
  // launch. CDS's own mail and every transactional type are untouched. Type name only in logs.
  if (
    spec.class === "marketing" &&
    as.kind === "org" &&
    !(await orgIsLive(orgKey))
  ) {
    console.info(`[email] held before launch: ${String(type)}`);
    return { status: "held" };
  }

  // 1c. Demo drop (13-24, STAFF-18, D293): mail sent as, or about, the demo org never leaves.
  // The org the mail concerns, not RenderedEmail.orgId (null for CDS-identity mail).
  const concerns =
    as.kind === "org"
      ? orgKey
      : typeof deps.concernsOrg === "string"
        ? deps.concernsOrg
        : "";
  if (concerns !== "" && (await orgIsDemo(concerns))) {
    console.info("[email] demo: not sent");
    return { status: "skipped", reason: "demo" };
  }

  // 2. The one suppression list (D138).
  if (!(await canSend(as, recipient, spec.class))) {
    return { status: "suppressed" };
  }

  // 3. Sender identity (D112, D173).
  const identity: SenderIdentity =
    as.kind === "cds"
      ? as.noReply === true
        ? { kind: "cds", noReply: true }
        : { kind: "cds" }
      : await orgIdentity(orgKey);
  // No-reply mail never carries a Reply-To, not even a per-message one (D97).
  const noReply = as.kind === "cds" && as.noReply === true;
  const sender = senderFor(identity, {
    mailDomain: mailDomain(),
    supportEmail: supportEmail(),
  });

  // 4. Render (escaped HTML + plain text).
  const parts = renderEmail(type, data, {
    brand: as.kind === "cds" ? undefined : sender.fromName,
  });

  // 5. Headers: marketing mail must carry a one-click unsubscribe (RFC 8058).
  const headers: Record<string, string> = {};
  if (spec.class === "marketing") {
    const post = (data as { unsubscribePostUrl?: unknown }).unsubscribePostUrl;
    if (typeof post !== "string") {
      throw new InvalidInput("a marketing email needs an unsubscribe link");
    }
    headers["List-Unsubscribe"] = headerValue(`<${safeHref(post)}>`);
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  const overrides = noReply
    ? []
    : [
        ...new Set(
          (typeof deps.replyTo === "string"
            ? [deps.replyTo]
            : (deps.replyTo ?? [])
          )
            .filter((a) => isEmail(String(a).trim().toLowerCase()))
            .map((a) => normaliseEmail(a)),
        ),
      ];
  const override = overrides.length > 0 ? overrides.join(", ") : null;

  const msg: RenderedEmail = {
    type: String(type),
    orgId: as.kind === "cds" ? null : orgKey,
    to: recipient,
    fromName: sender.fromName,
    fromAddress: sender.fromAddress,
    replyTo: override ?? sender.replyTo,
    subject: headerValue(parts.subject),
    preheader: parts.preheader,
    html: parts.html,
    text: parts.text,
    headers,
  };

  // 6. Transport.
  const transport = deps.transport ?? getEmailTransport();
  try {
    await transport.send(msg);
  } catch (err) {
    failures += 1;
    const e = new EmailSendFailed(`sending ${String(type)} failed`);
    (e as Error & { cause?: unknown }).cause = err;
    throw e;
  }
  return { status: "sent" };
}

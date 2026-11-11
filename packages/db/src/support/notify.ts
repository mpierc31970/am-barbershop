// P12 support notifications (12-05; COMM-03, COMM-10; D97, D313; RESEARCH Pattern 4).
// The one path every support event uses to raise a bell row and an email. It reuses raiseAlert
// (never forks it): one bell row per key (renotify replaces an unread one), an email per event
// sent as "CDS Support" from a no-reply address, each person's channel prefs honoured.
//
// Keys:      support:ticket:<number> (support.reply, support.status)
//            support:closed:<number> (support.status to closed; a plain alert, 12-REVIEW CR-A01:
//                                     a closed ticket has no Needs-you item, so under the ticket
//                                     key it would be born cleared)
//            support:messages        (cds.message, cds.note)
//            cds:document:<id>       (cds.document; a plain alert, cleared when read)
//            cds:notice:<windowId>   (cds.notice)
//            cds:idea:<ideaId>       (cds.idea_built; a plain alert, CR-A01)
// Audience:  ticket kinds → the filer plus every Owner and Admin; the others → every member
//            (eligibleFor still drops Viewers for normal alerts, T-12-05-02).
import { InvalidInput, type OrgRole } from "@cds/core";
import type { AlertTypeSpec } from "@cds/core/alerts";
import type { TicketStatus } from "@cds/core/support";
import { raiseAlert, type AlertAudience } from "../alerts/raise";
import type { PushSender } from "../alerts/push";
import {
  assertOrgContext,
  assertPlatformContext,
  assertSystemContext,
  isOrgContext,
  isPlatformContext,
  mintSystemContext,
  type OrgContext,
  type PlatformContext,
  type SystemContext,
} from "../context";
import { platformUrl } from "../email/env";
import { ratingLinkPath } from "./rating-links";
import type { SupportEmailKind } from "../email/render/templates";
import type { EmailTransport } from "../email/transport";

export type SupportNotifyType = SupportEmailKind;

export type SupportNotifyInput = {
  orgId: string;
  /** Who caused it: a staff PlatformContext, a job's SystemContext, or a member of this org. */
  as: OrgContext | PlatformContext | SystemContext;
  type: SupportNotifyType;
  /** Required for support.reply / support.status (status required for support.status). */
  ticket?: {
    number: number;
    subject: string;
    /** The user id of the member who filed it; they hear about it whatever their role. */
    filer?: string;
    status?: TicketStatus;
    /**
     * 13-16 choice 4: the support_threads id. On support.status Resolved it signs the two
     * one-tap rating links (14 days) the email carries; omitted means no links.
     */
    threadId?: string;
  };
  /** Bell title (UI-SPEC lines 638-642), e.g. "CDS replied to ticket #1042". */
  title: string;
  /** Relative hub link; must pass isHubHref. */
  href: string;
  /** Message, note or notice text; the email carries only the first 300 characters. */
  excerpt?: string;
  /** First name of the CDS person for "Mara from CDS replied". */
  authorFirstName?: string;
  businessName: string;
  /** Note or document title for the email subject (cds.note, cds.document). */
  itemTitle?: string;
  /** cds.document: the cds_documents id (key `cds:document:<id>`). */
  documentId?: string;
  /** cds.notice: the service_windows id (key `cds:notice:<id>`). */
  windowId?: string;
  /** cds.idea_built: the feature_ideas id (key `cds:idea:<id>`). */
  ideaId?: string;
};

export type SupportNotifyDeps = {
  now?: Date;
  transport?: EmailTransport;
  push?: PushSender;
  /** Composed alert registry; defaults to the registered types. */
  types?: readonly AlertTypeSpec[];
};

export type SupportNotifyResult = { raised: number; emailed: number };

const ID_RE = /^[a-z0-9]{1,30}$/i;
const TICKET_KINDS: ReadonlySet<SupportNotifyType> = new Set([
  "support.reply",
  "support.status",
]);
const ALL_ROLES: readonly OrgRole[] = ["owner", "admin", "editor", "viewer"];
const TICKET_ROLES: readonly OrgRole[] = ["owner", "admin"];

const ACTION_LABEL: Readonly<Record<SupportNotifyType, string>> = {
  "support.reply": "Read the reply",
  "support.status": "Open the ticket",
  "cds.message": "Read the message",
  "cds.note": "Read the note",
  "cds.document": "Open Documents",
  "cds.notice": "Open your hub",
  "cds.idea_built": "See the idea",
};

/** Notifications are raised under a job context; the caller's context is checked, not reused. */
const NOTIFY_CTX = mintSystemContext({ job: "support-notify" });

function checkCaller(input: SupportNotifyInput): void {
  const as: unknown = input.as;
  if (isOrgContext(as)) {
    assertOrgContext(as);
    if (as.orgId !== input.orgId) {
      throw new InvalidInput("support notice for another organization");
    }
    return;
  }
  if (isPlatformContext(as)) {
    assertPlatformContext(as);
    return;
  }
  assertSystemContext(as);
}

function sourceKeyFor(input: SupportNotifyInput): string {
  switch (input.type) {
    case "support.reply":
      return `support:ticket:${ticketOf(input).number}`;
    case "support.status": {
      const t = ticketOf(input);
      return t.status === "closed"
        ? `support:closed:${t.number}`
        : `support:ticket:${t.number}`;
    }
    case "cds.message":
    case "cds.note":
      return "support:messages";
    case "cds.document":
      return `cds:document:${idOf(input.documentId, "document")}`;
    case "cds.notice":
      return `cds:notice:${idOf(input.windowId, "window")}`;
    case "cds.idea_built":
      return `cds:idea:${idOf(input.ideaId, "idea")}`;
    default:
      throw new InvalidInput("unknown support notice type");
  }
}

function idOf(v: string | undefined, what: string): string {
  if (typeof v !== "string" || !ID_RE.test(v)) {
    throw new InvalidInput(`a ${what} id is required`);
  }
  return v;
}

function ticketOf(
  input: SupportNotifyInput,
): NonNullable<SupportNotifyInput["ticket"]> {
  const t = input.ticket;
  if (!t || !Number.isInteger(t.number) || t.number <= 0) {
    throw new InvalidInput("a ticket number is required");
  }
  if (input.type === "support.status" && !t.status) {
    throw new InvalidInput("a ticket status is required");
  }
  return t;
}

const THREAD_ID_RE = /^[a-z0-9]{15}$/;

/** Absolute up/down rating links for a support.status Resolved email, else undefined. */
function ratingLinksFor(
  input: SupportNotifyInput,
  now: Date | undefined,
): { up: string; down: string } | undefined {
  const t = input.ticket;
  if (input.type !== "support.status" || t?.status !== "resolved") {
    return undefined;
  }
  if (typeof t.threadId !== "string" || !THREAD_ID_RE.test(t.threadId)) {
    return undefined;
  }
  const at = now ?? new Date();
  return {
    up: platformUrl(ratingLinkPath(t.number, t.threadId, "up", at)),
    down: platformUrl(ratingLinkPath(t.number, t.threadId, "down", at)),
  };
}

function audienceFor(input: SupportNotifyInput): AlertAudience {
  if (TICKET_KINDS.has(input.type)) {
    const filer = input.ticket?.filer;
    return {
      users: typeof filer === "string" && ID_RE.test(filer) ? [filer] : [],
      roles: TICKET_ROLES,
    };
  }
  return { roles: ALL_ROLES };
}

/**
 * Raise one support alert (bell + push + email per person's prefs). Returns how many bell rows
 * were raised and how many emails went out, for CLI output ("2 alerts raised"). Bad input
 * throws InvalidInput; a delivery failure is logged by raiseAlert and never thrown.
 */
export async function notifySupport(
  input: SupportNotifyInput,
  deps: SupportNotifyDeps = {},
): Promise<SupportNotifyResult> {
  if (typeof input?.orgId !== "string" || !ID_RE.test(input.orgId)) {
    throw new InvalidInput("an organization id is required");
  }
  checkCaller(input);
  const sourceKey = sourceKeyFor(input);
  const ticket = TICKET_KINDS.has(input.type) ? ticketOf(input) : undefined;
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) throw new InvalidInput("a title is required");
  if (
    (input.type === "cds.note" ||
      input.type === "cds.document" ||
      input.type === "cds.idea_built") &&
    !input.itemTitle?.trim()
  ) {
    throw new InvalidInput("an item title is required");
  }

  const ratingLinks = ratingLinksFor(input, deps.now);
  let emailed = 0;
  const res = await raiseAlert(
    { orgId: input.orgId, as: NOTIFY_CTX },
    {
      type: input.type,
      sourceKey,
      title,
      // Support copy never names a client, so the title is safe in sensitive mode too.
      safeTitle: title,
      href: input.href,
      actionLabel: ACTION_LABEL[input.type],
      audience: audienceFor(input),
    },
    {
      now: deps.now,
      transport: deps.transport,
      push: deps.push,
      types: deps.types,
      renotify: true,
      cdsEmail: {
        type: "support.notify",
        // 13-24 (D293): CDS-identity mail about this org; dropped for the demo org.
        concernsOrg: input.orgId,
        vars: {
          kind: input.type,
          business: input.businessName,
          ticket: ticket
            ? {
                number: ticket.number,
                subject: ticket.subject,
                status: ticket.status,
              }
            : undefined,
          title: input.type === "cds.notice" ? title : input.itemTitle?.trim(),
          authorFirstName: input.authorFirstName,
          excerpt: input.excerpt,
          ...(ratingLinks ? { ratingLinks } : {}),
          href: platformUrl(input.href),
        },
      },
      onEmailed: () => {
        emailed += 1;
      },
    },
  );
  return { raised: res.recipients, emailed };
}

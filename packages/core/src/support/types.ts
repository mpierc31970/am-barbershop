// @cds/core/support types (P12; COMM-06, COMM-09, COMM-11, SUPPORT-02, SUPPORT-03; D94-D102,
// D297, D299). Pure and browser-safe. Field names follow the 12-02 migrations.
//
// `Tenant*` projections never carry staff-only data (assignee, priority, internal messages,
// staff ids, SLA due/warned timers). The one SLA field a tenant sees is `first_replied_at`:
// the ticket detail shows when CDS first replied (browser-allowed in BROWSER_FIELDS; review
// IN-B04). Staff-side shapes live in @cds/db.

/** The five ticket types (D94). `suggestion` routes to Ideas. */
export const TICKET_TYPES = [
  "problem",
  "change",
  "question",
  "billing",
  "suggestion",
] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

/** Ticket statuses (D95, COMM-09). The order is the lifecycle order. */
export type TicketStatus =
  "open" | "in_progress" | "waiting_on_you" | "resolved" | "closed";

/** `support_threads.kind`: the one ongoing conversation, or a numbered ticket. */
export type ThreadKind = "conversation" | "ticket";

/** Staff-only triage priority (never in a Tenant* type). */
export type Priority = "low" | "normal" | "high" | "urgent";

/** Where a ticket points: whole site, one page, one add-on, or a site part. */
export type TargetRef = {
  kind: "site" | "page" | "addon" | "part";
  id: string;
  label: string;
};

/** Site parts a ticket or a component window can name. */
export type SitePart = "header" | "footer" | "menus";

/** `service_windows.scope` (D99-D101). */
export const WINDOW_SCOPES = [
  "platform",
  "addon",
  "organization",
  "page",
  "component",
] as const;
export type WindowScope = (typeof WINDOW_SCOPES)[number];

/** Paid-service categories (SUPPORT-03, D297). */
export const PAID_CATEGORY_KEYS = [
  "copywriting",
  "design",
  "page_building",
  "product_entry",
  "newsletters",
  "photos",
  "logos",
  "seo",
  "custom",
] as const;
export type PaidCategory = (typeof PAID_CATEGORY_KEYS)[number];

/**
 * `support_threads.paid_service` json (P12-P7): tenant-safe data only. Staff commentary goes
 * in internal messages. Timestamps are ISO strings.
 */
export type PaidService = {
  category: PaidCategory;
  marked_at: string;
  quote_requested_at?: string | null;
  /** work_orders id once staff send a quote with `work:quote --ticket`. */
  work_order?: string | null;
  quote_sent_at?: string | null;
  amount_cents?: number | null;
  accepted_at?: string | null;
  care_chosen_at?: string | null;
  /** users id of the owner who chose the Care hour. */
  care_chosen_by?: string | null;
};

/** `support_files.scan` (P12-P3): staff files need no scan; tenant files wait for one. */
export type FileScan = "clean" | "pending" | "staff";

/** `member_prefs.support_read`: thread id -> ISO time the person last read it. */
export type SupportRead = Record<string, string>;

// ---------------------------------------------------------------------------------------
// Tenant projections (what the hub may render)

export type TenantAttachment = {
  id: string;
  name: string;
  size: number;
  mime: string;
  scan: FileScan;
};

export type TenantMessage = {
  id: string;
  authorKind: "member" | "staff" | "system";
  /** Display name; staff show as their first name or "CDS". */
  authorName: string;
  body: string;
  /** System lines carry their event label (e.g. "Reopened by your reply"). */
  event?: string | null;
  attachments: TenantAttachment[];
  created: string;
};

export type TenantTicket = {
  id: string;
  number: number;
  type: TicketType;
  subject: string;
  status: TicketStatus;
  target: TargetRef;
  openedByCds: boolean;
  paid: PaidService | null;
  /** Linked incident's public view, when any. */
  incident: IncidentView | null;
  lastActivityAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  created: string;
  unread: boolean;
};

export type CdsNote = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  authorName: string;
  created: string;
  updated: string;
};

export type CdsDocument = {
  id: string;
  title: string;
  note: string;
  filename: string;
  size: number;
  mime: string;
  authorName: string;
  created: string;
};

/** A file attached in a thread, as listed in Documents. */
export type ThreadFile = TenantAttachment & {
  threadId: string;
  ticketNumber: number | null;
  authorKind: "member" | "staff";
  created: string;
};

export type IncidentView = {
  title: string;
  public_text: string;
  status: "open" | "resolved";
};

/** One notice strip (COMM-11). `phase` decides active vs planned copy. */
export type ServiceNotice = {
  id: string;
  /** Display code `W-<seq>` (P12-P6). */
  code: string;
  phase: "active" | "upcoming";
  text: string;
  message: string;
  startsAt: string;
  endsAt: string;
  incident: IncidentView | null;
  /** Upcoming notices only: the person may dismiss it (P12-P10). */
  dismissible: boolean;
  /**
   * Where the strip shows (12-14, UI-SPEC line 566): page and component windows only on their
   * own screens; absent or `everywhere` (platform, add-on, organization) on every hub screen.
   */
  reach?: NoticeReach;
  /**
   * 12-17: the window's scope and (add-on scope) slug, so an editor can tell with core
   * `lockCovers` whether the notice locks its target (an add-on window reaches every screen
   * but locks only its add-on).
   */
  scope?: WindowScope;
  addon?: string;
};

/** The screens a notice reaches (12-14 `noticesForPath`). */
export type NoticeReach =
  | { scope: "everywhere" }
  | { scope: "page"; page: string }
  | { scope: "component"; component: string };

export type IdeaCard = {
  id: string;
  title: string;
  description: string;
  status: "suggested" | "considering" | "planned" | "built";
  votes: number;
  /** This site voted for it. */
  voted: boolean;
  /** This site suggested it (business name never shown, IDEA-PUBLIC). */
  mine: boolean;
  created: string;
};

/** What the paid-service panel shows to this person (SUPPORT-03). */
export type PaidPanelState = {
  category: PaidCategory;
  /** Only the Owner can choose; Admin/Editor see PAID-ASK-OWNER. */
  canChoose: boolean;
  helpId: string;
  quoteRequested: boolean;
  /** work_orders id for View quote, once sent. */
  quoteId: string | null;
  accepted: boolean;
  careHourAvailable: boolean;
  careChosen: boolean;
};

export type HeldDraftView = {
  id: string;
  kind: "section" | "page" | "site_part" | "addon_record";
  target: string;
  label: string;
  created: string;
};

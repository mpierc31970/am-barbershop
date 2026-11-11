// packages/db/src/launch-review/facts.ts (P14 14-33, DOM-10, D172, P14-P14).
// Internal: never in a barrel. One superuser read of everything the six launch review items
// are computed from, for one org whose id the caller already scoped (an OrgContext's own id,
// or a system path). "Edited after approval resets it" is computed here, never stored: a page
// mark counts only while its page_version equals the page's current published_at.
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { addonSiteStateIn } from "../addons/site-state";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import type { OrgContext, SystemContext } from "../context";
import { newRecordId } from "../repository";

export const MARKS = "launch_review_marks";

/** The two system policy pages (P9 site policies); published once acknowledged. */
export const POLICY_PAGES = [
  { id: "privacy", title: "Privacy policy", path: "/privacy" },
  { id: "terms", title: "Terms", path: "/terms" },
] as const;

export type ReviewPageStatus =
  "looks_good" | "needs_change" | "not_looked" | "changed_since";

export type ReviewPageFact = {
  id: string;
  title: string;
  path: string;
  /** The page's current published version stamp (published_at, or the policy ack time). */
  version: string;
  status: ReviewPageStatus;
  /** The P12 ticket number sent for a Needs-a-change mark (0 = none sent). */
  noteTicket: number;
  policy: boolean;
};

export type MarkFact = {
  id: string;
  kind: string;
  page: string;
  status: string;
  version: string;
  at: string | null;
  noteTicket: number;
};

export type ReviewFacts = {
  stage: string;
  pages: ReviewPageFact[];
  keyFactsAt: string | null;
  phoneCheckAt: string | null;
  testFormAt: string | null;
  submittedAt: string | null;
  emailConfirmed: boolean;
  /** The first unconfirmed address (for FACTS-EMAIL), or "". */
  unconfirmedEmail: string;
  hasForm: boolean;
  testReceived: boolean;
  openChangeRequests: number;
  /** The open move: prepared = the domain is ready for launch. */
  move: { code: string; toHost: string; status: string } | null;
  done: Set<string>;
};

const HOME_SLUG = "home";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function dateOrNull(v: unknown): string | null {
  const s = str(v).trim();
  return s === "" ? null : s;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Comparable instant of a PocketBase date ("2026-10-17 10:00:00.000Z") or ISO string. */
export function instant(v: string | null): number {
  if (!v) return Number.NaN;
  return Date.parse(v.includes("T") ? v : v.replace(" ", "T"));
}

/**
 * Titles of review pages whose published version is newer than the owner's Ready to launch
 * (RESUBMIT). A non-empty list means the send is stale: owner side and staff gate (CR-D01)
 * both treat it as not sent.
 */
export function resubmitNeededOf(
  f: Pick<ReviewFacts, "submittedAt" | "pages">,
): string[] {
  const sent = instant(f.submittedAt);
  if (!Number.isFinite(sent)) return [];
  return f.pages.filter((p) => instant(p.version) > sent).map((p) => p.title);
}

function toMark(r: RecordModel): MarkFact {
  return {
    id: r.id,
    kind: str(r.kind),
    page: str(r.page),
    status: str(r.status),
    version: str(r.page_version),
    at: dateOrNull(r.at),
    noteTicket: num(r.note_ticket),
  };
}

function pageStatus(
  mark: MarkFact | undefined,
  version: string,
): ReviewPageStatus {
  if (!mark) return "not_looked";
  if (mark.version !== version) return "changed_since";
  return mark.status === "needs_change" ? "needs_change" : "looks_good";
}

/** The review page set (P14-P14) and its marks; one row per review page. */
async function reviewPageRows(
  pb: PocketBase,
  orgId: string,
): Promise<
  {
    id: string;
    title: string;
    path: string;
    version: string;
    policy: boolean;
  }[]
> {
  const rows = await pb.collection("pages").getFullList({
    filter: pb.filter(
      "organization = {:org} && status = 'published' && deleted_at = '' && kind != 'system-404'",
      { org: orgId },
    ),
    sort: "created,id",
    fields: "id,title,slug,published_at",
  });
  const hidden = new Set((await addonSiteStateIn(pb, orgId)).hiddenPageIds);
  const pages = rows
    .filter((r) => !hidden.has(r.id))
    .map((r) => {
      const slug = str(r.slug);
      return {
        id: r.id,
        title: str(r.title).trim() || slug || "Untitled page",
        path: slug === HOME_SLUG || slug === "" ? "/" : `/${slug}`,
        version: str(r.published_at),
        policy: false,
        home: slug === HOME_SLUG,
      };
    });
  // Home first, then creation order.
  pages.sort((a, b) => Number(b.home) - Number(a.home));
  const ack = await pb.collection("site_policy_acks").getList(1, 1, {
    filter: pb.filter("organization = {:org} && kind = 'ack'", { org: orgId }),
    sort: "-acked_at,-id",
    fields: "id,acked_at",
    skipTotal: true,
  });
  const ackRow = ack.items[0];
  const out: {
    id: string;
    title: string;
    path: string;
    version: string;
    policy: boolean;
  }[] = pages.map((p) => ({
    id: p.id,
    title: p.title,
    path: p.path,
    version: p.version,
    policy: false,
  }));
  if (ackRow) {
    for (const p of POLICY_PAGES) {
      out.push({ ...p, version: str(ackRow.acked_at), policy: true });
    }
  }
  return out;
}

export async function loadReviewFacts(
  pb: PocketBase,
  orgId: string,
): Promise<ReviewFacts> {
  const org = await pb
    .collection("organizations")
    .getOne(orgId, { fields: "id,stage" });
  const [pageRows, markRows, routes, forms, tests, tickets, moves] =
    await Promise.all([
      reviewPageRows(pb, orgId),
      pb.collection(MARKS).getFullList({
        filter: pb.filter("organization = {:org}", { org: orgId }),
        sort: "created,id",
      }),
      pb.collection("org_email_routes").getFullList({
        filter: pb.filter("organization = {:org}", { org: orgId }),
        fields: "id,address,confirmed_at",
        sort: "created,id",
      }),
      pb.collection("forms").getList(1, 1, {
        filter: pb.filter("organization = {:org} && deleted_at = ''", {
          org: orgId,
        }),
        fields: "id",
        skipTotal: true,
      }),
      pb.collection("form_submissions").getList(1, 1, {
        filter: pb.filter("organization = {:org} && is_test = true", {
          org: orgId,
        }),
        fields: "id",
        skipTotal: true,
      }),
      pb.collection("support_threads").getList(1, 1, {
        filter: pb.filter(
          "organization = {:org} && type = 'change' && (status = 'open' || status = 'in_progress' || status = 'waiting_on_you')",
          { org: orgId },
        ),
        fields: "id",
      }),
      pb.collection("domain_moves").getList(1, 1, {
        filter: pb.filter(
          "org_id = {:org} && (status = 'running' || status = 'waiting_owner' || status = 'prepared' || status = 'cutover_running' || status = 'failed')",
          { org: orgId },
        ),
        sort: "-created,-id",
        fields: "id,seq,status,to_host",
        skipTotal: true,
      }),
    ]);

  const marks = markRows.map(toMark);
  const pageMarks = new Map(
    marks.filter((m) => m.kind === "page").map((m) => [m.page, m]),
  );
  const one = (kind: string) => marks.find((m) => m.kind === kind);
  const pages: ReviewPageFact[] = pageRows.map((p) => {
    const m = pageMarks.get(p.id);
    return {
      ...p,
      status: pageStatus(m, p.version),
      noteTicket: m?.noteTicket ?? 0,
    };
  });

  const unconfirmed = routes.find((r) => dateOrNull(r.confirmed_at) === null);
  const emailConfirmed = routes.length > 0 && !unconfirmed;
  const hasForm = forms.items.length > 0;
  const testReceived = tests.items.length > 0 || one("test_form") !== undefined;
  const moveRow = moves.items[0];

  const keyFacts = one("key_facts");
  const phone = one("phone_check");
  const done = new Set<string>();
  if (pages.length > 0 && pages.every((p) => p.status === "looks_good")) {
    done.add("pages_reviewed");
  }
  if (
    pages
      .filter((p) => p.status === "needs_change")
      .every((p) => p.noteTicket > 0)
  ) {
    done.add("changes_sent");
  }
  if (keyFacts && emailConfirmed) done.add("key_facts");
  if (phone) done.add("phone_check");
  if (!hasForm || testReceived) done.add("test_form");
  if (tickets.totalItems === 0) done.add("no_open_requests");

  return {
    stage: str(org.stage),
    pages,
    keyFactsAt: keyFacts?.at ?? null,
    phoneCheckAt: phone?.at ?? null,
    testFormAt: one("test_form")?.at ?? null,
    submittedAt: one("submitted")?.at ?? null,
    emailConfirmed,
    unconfirmedEmail: unconfirmed ? str(unconfirmed.address) : "",
    hasForm,
    testReceived,
    openChangeRequests: tickets.totalItems,
    move: moveRow
      ? {
          code: `M-${Number(moveRow.seq)}`,
          toHost: str(moveRow.to_host),
          status: str(moveRow.status),
        }
      : null,
    done,
  };
}

function pbDate(d: Date): string {
  return d.toISOString().replace("T", " ");
}

export type MarkKind =
  "page" | "key_facts" | "phone_check" | "test_form" | "submitted";

export type UpsertMarkInput = {
  orgId: string;
  kind: MarkKind;
  page?: string;
  status: "looks_good" | "needs_change" | "done";
  version?: string;
  by: string;
  at: Date;
  noteTicket?: number;
  audit: OrgContext | SystemContext;
  auditAction?: string;
  auditMeta?: Record<string, unknown>;
};

/**
 * Upsert one mark by (organization, kind, page) + its audit row in one batch (14-33 choice 1).
 * Internal writer: the caller authorized and holds the org lock. Audit meta names the kind,
 * page id and status only.
 */
export async function upsertMark(
  pb: PocketBase,
  input: UpsertMarkInput,
): Promise<{ id: string; at: string }> {
  const page = input.page ?? "";
  const existing = await pb
    .collection(MARKS)
    .getList(1, 1, {
      filter: pb.filter(
        "organization = {:org} && kind = {:kind} && page = {:page}",
        { org: input.orgId, kind: input.kind, page },
      ),
      fields: "id",
      skipTotal: true,
    })
    .then((r) => r.items[0] ?? null);
  const id = existing?.id ?? newRecordId();
  const body: Record<string, unknown> = {
    organization: input.orgId,
    kind: input.kind,
    page,
    status: input.status,
    page_version: (input.version ?? "").slice(0, 40),
    by: input.by.slice(0, 15),
    at: pbDate(input.at),
  };
  if (input.noteTicket !== undefined) body.note_ticket = input.noteTicket;
  const batch = pb.createBatch();
  if (existing) batch.collection(MARKS).update(id, body);
  else batch.collection(MARKS).create({ id, ...body });
  batch.collection("audit_log").create(
    auditBody(input.audit, {
      action: input.auditAction ?? "launch_review.marked",
      organization: input.orgId,
      targetCollection: MARKS,
      targetId: id,
      meta: input.auditMeta ?? {
        kind: input.kind,
        ...(page ? { page } : {}),
        status: input.status,
      },
    }),
  );
  await batch.send();
  return { id, at: input.at.toISOString() };
}

/** loadReviewFacts on its own superuser client. */
export function reviewFactsFor(orgId: string): Promise<ReviewFacts> {
  return withSuperuser((pb) => loadReviewFacts(pb, orgId));
}

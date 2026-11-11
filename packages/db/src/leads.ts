// Staff leads list (ONB-07; planner decision PD-7; T-06-48, T-06-49). A lead is someone who
// configured a site and did not finish: a saved quote (saved, reminded or expired; an email
// was given) or an organization still in setup (stage intake with the intake not sent, or
// stage fit_review). Unsaved drafts and submitted quotes are not leads. ready_for_build and
// being_built orgs are listed so staff see assembly progress (P8 R-6); ONB-07 refinement:
// STATUS `sent` / `being built`, and ASSEMBLED from the org_intake.assembly ledger.
// super_admin + support_agent (leads_list). Read-only: nothing is written or exported.
// Scale is 10-50 tenants and a few hundred quotes, so full lists are read in one pass.
// P15 (15-07, A3-Q2): hub /contact inquiries are leads too (kind "inquiry", from
// listHubInquiries; never the message or the IP bucket), so no contact is lost.
import { authorizeStaff } from "@cds/core";
import { isStageSlug } from "@cds/core/intake";
import type { RecordModel } from "pocketbase";
import { dayMonth } from "./assembly/report";
import { parseLedger } from "./assembly/ledger";
import { withSuperuser } from "./client";
import { assertPlatformContext, type PlatformContext } from "./context";
import { listHubInquiries, type HubInquiryTopic } from "./hub-inquiries";

export type Lead = {
  kind: "quote" | "org" | "inquiry";
  id: string;
  email: string;
  path: string;
  businessType: string;
  items: number;
  /**
   * "saved" | "reminded 1" | "reminded 2" | "expired" | "intake 3/7" | "fit_review" |
   * "sent" | "being built"; an inquiry: its topic word, plus " · <about>" when given
   * ("Book a call · Salon owner").
   */
  status: string;
  /** Assembly progress (08-18): "-" | "queued" | "running" | "done 7 Oct" | "failed 3/3" */
  assembled: string;
  lastChange: Date;
  /** Inquiries only: the sender's name and business (quotes and orgs leave these unset). */
  name?: string;
  business?: string;
};

export type ListLeadsOptions = { since?: Date };

const STAGE_TOTAL = 7;
/** Matches ASSEMBLY_MAX_ATTEMPTS (assembly/run.ts): the sweep stops after 3 failures. */
const ASSEMBLY_ATTEMPTS = 3;

/** Staff topic words for an inquiry lead (match the hub.inquiry email's topic labels). */
export const INQUIRY_TOPIC_LABELS: Record<HubInquiryTopic, string> = {
  question: "Question",
  call: "Book a call",
  press: "Press",
};

/** "Book a call · Salon owner"; the topic word alone when `about` is empty. */
export function inquiryStatus(topic: HubInquiryTopic, about: string): string {
  const label = INQUIRY_TOPIC_LABELS[topic] ?? INQUIRY_TOPIC_LABELS.question;
  const a = about.trim();
  return a ? `${label} · ${a}` : label;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function toDate(v: unknown): Date | null {
  if (typeof v !== "string" || v === "") return null;
  const d = new Date(v.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** add-ons + extras chosen, from a stored selections JSON (anything malformed counts 0). */
function itemCount(raw: unknown): number {
  if (!raw || typeof raw !== "object") return 0;
  const s = raw as { addons?: unknown; extras?: unknown };
  const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  return len(s.addons) + len(s.extras);
}

/** Distinct known stage slugs saved so far (junk and repeats ignored). */
function stagesDone(raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  return new Set(raw.filter(isStageSlug)).size;
}

function quoteStatus(r: RecordModel): string {
  if (r.status === "expired") return "expired";
  const sent = Number(r.reminders_sent);
  return Number.isSafeInteger(sent) && sent > 0 ? `reminded ${sent}` : "saved";
}

/** The ASSEMBLED word from a stored ledger; "-" when no assembly was ever recorded. */
export function assembledWord(raw: unknown): string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "-";
  if (Object.keys(raw).length === 0) return "-";
  const ledger = parseLedger(raw);
  switch (ledger.status) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "done": {
      const day = dayMonth(ledger.assembled_at);
      return day ? `done ${day}` : "done";
    }
    case "failed":
      return `failed ${Math.min(ledger.attempts, ASSEMBLY_ATTEMPTS)}/${ASSEMBLY_ATTEMPTS}`;
  }
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * UI-SPEC last line: "12 leads: 8 saved quotes, 4 sites in setup." plus ", 2 assembled"
 * when any org's assembly is done (08-18), plus ", 3 inquiries" when any hub inquiry is
 * listed (15-07).
 */
export function leadsSummaryLine(leads: readonly Lead[]): string {
  const quotes = leads.filter((l) => l.kind === "quote").length;
  const orgs = leads.filter((l) => l.kind === "org").length;
  const inquiries = leads.filter((l) => l.kind === "inquiry").length;
  const done = leads.filter((l) => l.assembled.startsWith("done")).length;
  return (
    `${plural(leads.length, "lead", "leads")}: ` +
    `${plural(quotes, "saved quote", "saved quotes")}, ` +
    `${plural(orgs, "site in setup", "sites in setup")}` +
    `${inquiries > 0 ? `, ${plural(inquiries, "inquiry", "inquiries")}` : ""}` +
    `${done > 0 ? `, ${done} assembled` : ""}.`
  );
}

function orgStatus(stage: unknown, stagesSaved: unknown): string {
  if (stage === "fit_review") return "fit_review";
  if (stage === "ready_for_build") return "sent";
  if (stage === "being_built") return "being built";
  return `intake ${stagesDone(stagesSaved)}/${STAGE_TOTAL}`;
}

function latest(...dates: (Date | null)[]): Date {
  let best = 0;
  for (const d of dates) if (d && d.getTime() > best) best = d.getTime();
  return new Date(best);
}

/**
 * Every lead (saved quotes, sites in setup, hub inquiries), newest last change first. `since`
 * keeps only leads changed at or after it (an inquiry's change is its `created`).
 */
export async function listLeads(
  ctx: PlatformContext,
  opts: ListLeadsOptions = {},
): Promise<Lead[]> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "leads_list");
  const since =
    opts.since instanceof Date && !Number.isNaN(opts.since.getTime())
      ? opts.since
      : null;

  const leads = await withSuperuser(async (pb) => {
    const quotes = await pb.collection("quotes").getFullList({
      filter: "(status = 'saved' || status = 'expired') && email != ''",
      fields:
        "id,email,path,business_type,selections,status,reminders_sent,updated",
    });
    const orgs = await pb.collection("organizations").getFullList({
      filter:
        "stage = 'intake' || stage = 'fit_review' || stage = 'ready_for_build' || stage = 'being_built'",
      fields: "id,path,stage,updated",
    });
    if (orgs.length === 0) return { quotes, orgs, extra: new Map() };

    const orgIds = orgs.map((o) => o.id);
    // Bound params only; no template-literal filters (T-02-13).
    const inOrgs = orgIds
      .map((id, i) =>
        pb.filter("organization = {:o" + i + "}", { ["o" + i]: id }),
      )
      .join(" || ");
    const [intakes, profiles, routes, owners] = await Promise.all([
      pb.collection("org_intake").getFullList({
        filter: inOrgs,
        fields:
          "organization,selections,stages_saved,submitted_at,assembly,updated",
      }),
      pb.collection("business_profile").getFullList({
        filter: inOrgs,
        fields: "organization,business_type",
      }),
      pb.collection("org_email_routes").getFullList({
        filter: "purpose = 'default' && (" + inOrgs + ")",
        fields: "organization,address",
      }),
      pb.collection("memberships").getFullList({
        filter: "role = 'owner' && (" + inOrgs + ")",
        sort: "created,id",
        expand: "user",
        fields: "organization,expand.user.email",
      }),
    ]);
    const extra = new Map<
      string,
      {
        intake?: RecordModel;
        profile?: RecordModel;
        route?: string;
        owner?: string;
      }
    >();
    const slot = (org: unknown) => {
      const key = str(org);
      let e = extra.get(key);
      if (!e) extra.set(key, (e = {}));
      return e;
    };
    for (const r of intakes) slot(r.organization).intake = r;
    for (const r of profiles) slot(r.organization).profile = r;
    for (const r of routes) slot(r.organization).route = str(r.address);
    for (const r of owners) {
      const e = slot(r.organization);
      const email = str(
        (r.expand as { user?: { email?: unknown } } | undefined)?.user?.email,
      );
      if (!e.owner && email) e.owner = email;
    }
    return { quotes, orgs, extra };
  });

  const out: Lead[] = [];
  for (const q of leads.quotes) {
    out.push({
      kind: "quote",
      id: q.id,
      email: str(q.email),
      path: str(q.path),
      businessType: str(q.business_type),
      items: itemCount(q.selections),
      status: quoteStatus(q),
      assembled: "-",
      lastChange: latest(toDate(q.updated)),
    });
  }
  for (const o of leads.orgs) {
    const e = leads.extra.get(o.id) ?? {};
    // An org at intake whose intake was already sent is waiting on CDS, not a lead.
    if (o.stage === "intake" && str(e.intake?.submitted_at)) continue;
    out.push({
      kind: "org",
      id: o.id,
      email: e.route || e.owner || "",
      path: str(o.path),
      businessType: str(e.profile?.business_type),
      items: itemCount(e.intake?.selections),
      status: orgStatus(o.stage, e.intake?.stages_saved),
      assembled: assembledWord(e.intake?.assembly),
      lastChange: latest(toDate(o.updated), toDate(e.intake?.updated)),
    });
  }
  for (const q of await listHubInquiries(ctx, since ? { since } : {})) {
    out.push({
      kind: "inquiry",
      id: q.id,
      email: q.email,
      path: "",
      businessType: q.business || q.name,
      items: 0,
      status: inquiryStatus(q.topic, q.about),
      assembled: "-",
      lastChange: latest(toDate(q.created)),
      name: q.name,
      business: q.business,
    });
  }
  return out
    .filter((l) => !since || l.lastChange.getTime() >= since.getTime())
    .sort((a, b) => b.lastChange.getTime() - a.lastChange.getTime());
}

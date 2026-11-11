// Staff Find / Ctrl K (13-47 choice 2; STAFF-20, D119; 13-UI-SPEC "StaffFind"). One search over
// the existing staff reads, never a new query:
// - Tickets: "1042" / "#1042" (parseTicketNumber) puts that ticket first (staffGetTicket), then
//   subject matches (staffListTickets, every status), max 5.
// - Sites: business name, slug, host or org id (staffListSites q), max 5.
// - Cases: R-n (staffGetCase), I-n (staffListIncidents, resolved too), W-n
//   (staffListServiceWindows, ended too).
// Screens come from STAFF_SECTIONS client-side (apps/web), not from here. The query is trimmed
// and capped at 100 characters (T-13-47-02); filters are pb.filter bindings inside the reads.
// A group the role may not read is skipped; a group whose read fails is empty (logged by class).
import { authorizeStaff, NotFound } from "@cds/core";
import { parseTicketNumber } from "@cds/core/support";
import { assertPlatformContext, type PlatformContext } from "../context";
import { staffListIncidents } from "../support/incidents";
import { staffGetTicket, staffListTickets } from "../support/staff-tickets";
import { staffListServiceWindows } from "../support/windows";
import { staffGetCase } from "./review";
import { staffListSites } from "./sites";

export const STAFF_FIND_Q_MAX = 100;
export const STAFF_FIND_GROUP_MAX = 5;

export type StaffFindTicketHit = {
  number: number;
  subject: string;
  href: string;
  site: string;
};

export type StaffFindEntryHit = {
  group: "Sites" | "Cases";
  label: string;
  href: string;
  path?: string;
};

export type StaffFindResult = {
  tickets: StaffFindTicketHit[];
  sites: StaffFindEntryHit[];
  cases: StaffFindEntryHit[];
};

const CASE_RE = /^([RIW])-([1-9]\d{0,8})$/i;

function can(ctx: PlatformContext, feature: string): boolean {
  try {
    authorizeStaff(ctx.staffRole, feature);
    return true;
  } catch {
    return false;
  }
}

function ticketNumber(q: string): number | null {
  try {
    return parseTicketNumber(q);
  } catch {
    return null;
  }
}

async function safely<T>(
  name: string,
  fn: () => Promise<T>,
  empty: T,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof NotFound) return empty;
    console.error(
      `[staff find] ${name} failed ${err instanceof Error ? err.name : typeof err}`,
    );
    return empty;
  }
}

async function findTickets(
  ctx: PlatformContext,
  q: string,
  now: Date,
): Promise<StaffFindTicketHit[]> {
  if (!can(ctx, "support_read")) return [];
  const hits: StaffFindTicketHit[] = [];
  const number = ticketNumber(q);
  if (number !== null) {
    const t = await safely(
      "ticket",
      () => staffGetTicket(ctx, number, { now }),
      null,
    );
    if (t) {
      hits.push({
        number: t.number,
        subject: t.subject,
        href: `/staff/tickets/${t.number}`,
        site: t.orgName,
      });
    }
  }
  const needle = q.toLowerCase();
  const rows = await safely(
    "tickets",
    () => staffListTickets(ctx, { status: "all", now }),
    [],
  );
  for (const r of rows) {
    if (hits.length >= STAFF_FIND_GROUP_MAX) break;
    if (r.number === number) continue;
    if (r.subject.toLowerCase().includes(needle)) {
      hits.push({
        number: r.number,
        subject: r.subject,
        href: `/staff/tickets/${r.number}`,
        site: r.orgName,
      });
    }
  }
  return hits;
}

async function findSites(
  ctx: PlatformContext,
  q: string,
  now: Date,
): Promise<StaffFindEntryHit[]> {
  const rows = await safely("sites", () => staffListSites(ctx, { q, now }), []);
  return rows.slice(0, STAFF_FIND_GROUP_MAX).map((r) => {
    const host = r.liveHost ?? r.previewHost;
    return {
      group: "Sites" as const,
      label: r.name || r.slug || r.orgId,
      href: `/staff/sites/${r.orgId}`,
      ...(host ? { path: host } : {}),
    };
  });
}

async function findCases(
  ctx: PlatformContext,
  q: string,
  now: Date,
): Promise<StaffFindEntryHit[]> {
  const m = CASE_RE.exec(q);
  if (!m) return [];
  const letter = m[1]!.toUpperCase();
  const code = `${letter}-${Number(m[2])}`;
  if (letter === "R") {
    if (!can(ctx, "review_queue")) return [];
    const c = await safely(
      "case",
      () => staffGetCase(ctx, code, { now }),
      null,
    );
    if (!c) return [];
    return [
      {
        group: "Cases",
        label: `${c.ref} · ${c.kind === "dmca" ? "DMCA" : c.kind === "spot_check" ? "Spot check" : "Report"}`,
        href: `/staff/review/${c.ref}`,
        ...(c.business ? { path: c.business } : {}),
      },
    ];
  }
  if (letter === "I") {
    if (!can(ctx, "incident_run")) return [];
    const list = await safely(
      "incidents",
      () => staffListIncidents(ctx, { includeResolved: true }),
      [],
    );
    const i = list.find((x) => x.code.toUpperCase() === code);
    if (!i) return [];
    return [
      {
        group: "Cases",
        label: `${i.code} · ${i.title}`,
        href: `/staff/tickets?tab=incidents&open=${encodeURIComponent(i.code)}${i.status === "resolved" ? "&view=all" : ""}`,
        path:
          i.status === "resolved" ? "Incident · resolved" : "Incident · open",
      },
    ];
  }
  if (!can(ctx, "service_window_org")) return [];
  const windows = await safely(
    "windows",
    () =>
      staffListServiceWindows(ctx, { includeEnded: true }, { now: () => now }),
    [],
  );
  const w = windows.find((x) => x.code.toUpperCase() === code);
  if (!w) return [];
  const ended = w.phase === "ended";
  return [
    {
      group: "Cases",
      label: `${w.code} · ${w.message}`,
      href: ended
        ? "/staff/tickets?tab=windows&view=ended"
        : "/staff/tickets?tab=windows",
      path: ended ? "Service window · ended" : "Service window",
    },
  ];
}

/** Find (`console`): tickets, sites and cases for one query. Empty query = nothing. */
export async function staffFind(
  ctx: PlatformContext,
  query: unknown,
  opts: { now?: Date } = {},
): Promise<StaffFindResult> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "console");
  const q =
    typeof query === "string"
      ? query.trim().slice(0, STAFF_FIND_Q_MAX).trim()
      : "";
  if (!q) return { tickets: [], sites: [], cases: [] };
  const now = opts.now ?? new Date();
  const [tickets, sites, cases] = await Promise.all([
    findTickets(ctx, q, now),
    findSites(ctx, q, now),
    findCases(ctx, q, now),
  ]);
  return { tickets, sites, cases };
}

"use server";
// Incident actions (13-36 choice 3; STAFF-12, D103). Public POST endpoints: every argument is
// untrusted. Thin callers of the functions the `incident:run` CLI calls (`incident_run`, both
// staff roles, no step-up), with the CLI's result lines:
//   open    -> staffOpenIncident           "Opened I-3."
//   link    -> staffLinkTicketToIncident   "Linked #1042 (Rivera Bakery) to I-3. The owner sees …"
//   unlink  -> staffUnlinkTicketFromIncident (13-36: the console's per-row Unlink ticket)
//   resolve -> staffResolveIncident        "Resolved I-3. 4 linked tickets moved to Resolved,
//                                           4 alerts raised."
// Errors are logged by class name only; bodies are never logged.
import { parseTicketNumber } from "@cds/core/support";
import {
  staffLinkTicketToIncident,
  staffOpenIncident,
  staffResolveIncident,
  staffSupportLabels,
  staffUnlinkTicketFromIncident,
  type PlatformContext,
} from "@cds/db";
import { revalidatePath } from "next/cache";
import {
  errorName,
  runStaffAction,
  type ActionResult,
} from "../../../lib/staff-action";

type Failure = Extract<ActionResult<never>, { ok: false }>;

const INCIDENT_RE = /^I-[1-9]\d{0,8}$/i;
const TITLE_MAX = 80;
const PUBLIC_MAX = 500;
const MESSAGE_MAX = 5000;

const INCIDENT_NOT_FOUND: Failure = {
  ok: false,
  code: "not_found",
  message: "That incident wasn't found.",
};
const TICKET_BAD: Failure = {
  ok: false,
  code: "invalid_input",
  message: "Enter a ticket number, like 1042.",
  field: "ticket",
};

function bad(message: string, field?: string): Failure {
  return {
    ok: false,
    code: "invalid_input",
    message,
    ...(field ? { field } : {}),
  };
}

function own(raw: unknown, key: string): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return undefined;
  return Object.prototype.hasOwnProperty.call(raw, key)
    ? (raw as Record<string, unknown>)[key]
    : undefined;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function incidentOf(raw: unknown): string | null {
  if (typeof raw !== "string" || !INCIDENT_RE.test(raw.trim())) return null;
  return `I-${raw.trim().slice(2)}`;
}

/** "#1042", "1042" or 1042 → 1042; null when it isn't a ticket number. */
function ticketOf(raw: unknown): number | null {
  try {
    return parseTicketNumber(raw);
  } catch {
    return null;
  }
}

function refresh(): void {
  try {
    revalidatePath("/staff", "layout");
  } catch (err) {
    console.error("[staff incidents] revalidate failed", errorName(err));
  }
}

async function businessOf(
  ctx: PlatformContext,
  orgId: string,
): Promise<string> {
  try {
    const l = await staffSupportLabels(ctx, { orgIds: [orgId] });
    return l.orgs[orgId] || orgId;
  } catch (err) {
    console.error("[staff incidents] labels read failed", errorName(err));
    return orgId;
  }
}

/** Open a known problem: `{ title (staff-only, 80), publicText (what owners see, 2,000) }`. */
export async function openIncidentAction(
  input: unknown,
): Promise<ActionResult<{ message: string; code: string }>> {
  const titleRaw = own(input, "title");
  const publicRaw = own(input, "publicText");
  const title = typeof titleRaw === "string" ? titleRaw.trim() : "";
  const publicText = typeof publicRaw === "string" ? publicRaw.trim() : "";
  if (!title) return bad("Add a title.", "title");
  if (title.length > TITLE_MAX) {
    return bad(`Use ${TITLE_MAX} characters or fewer.`, "title");
  }
  if (!publicText) return bad("Add what owners see.", "publicText");
  if (publicText.length > PUBLIC_MAX) {
    return bad(`Use ${PUBLIC_MAX} characters or fewer.`, "publicText");
  }
  const result = await runStaffAction("incident_run", {}, async (ctx) => {
    const r = await staffOpenIncident(ctx, { title, publicText });
    return { message: `Opened ${r.code}.`, code: r.code };
  });
  if (result.ok) refresh();
  return result;
}

/** Link a ticket ("1042" or "#1042") to an open incident. */
export async function linkTicketAction(
  incidentRaw: unknown,
  ticketRaw: unknown,
): Promise<ActionResult<{ message: string; linked: boolean; number: number }>> {
  const incident = incidentOf(incidentRaw);
  if (!incident) return INCIDENT_NOT_FOUND;
  const number = ticketOf(ticketRaw);
  if (number === null) return TICKET_BAD;
  const result = await runStaffAction("incident_run", {}, async (ctx) => {
    const r = await staffLinkTicketToIncident(ctx, { incident, number });
    const business = await businessOf(ctx, r.orgId);
    return {
      message: r.linked
        ? `Linked #${r.number} (${business}) to ${r.code}. The owner sees "Linked to a known problem" and the public text.`
        : `#${r.number} (${business}) was already linked to ${r.code}; nothing changed.`,
      linked: r.linked,
      number: r.number,
    };
  });
  if (result.ok && result.data.linked) refresh();
  return result;
}

/** Take a ticket off an incident (the owner's "What happened" box goes with it). */
export async function unlinkTicketAction(
  incidentRaw: unknown,
  ticketRaw: unknown,
): Promise<ActionResult<{ message: string; unlinked: boolean }>> {
  const incident = incidentOf(incidentRaw);
  if (!incident) return INCIDENT_NOT_FOUND;
  const number = ticketOf(ticketRaw);
  if (number === null) return TICKET_BAD;
  const result = await runStaffAction("incident_run", {}, async (ctx) => {
    const r = await staffUnlinkTicketFromIncident(ctx, { incident, number });
    return {
      message: r.unlinked
        ? `Unlinked #${r.number} from ${r.code}.`
        : `#${r.number} wasn't linked to ${r.code}; nothing changed.`,
      unlinked: r.unlinked,
    };
  });
  if (result.ok && result.data.unlinked) refresh();
  return result;
}

/**
 * Resolve an incident ("Resolve I-3? 4 linked tickets will move to Resolved." → Resolve
 * incident). `message` is the optional closing message posted on each linked ticket.
 */
export async function resolveIncidentAction(
  incidentRaw: unknown,
  messageRaw?: unknown,
): Promise<
  ActionResult<{
    message: string;
    moved: number;
    alerts: number;
    skipped: number;
  }>
> {
  const incident = incidentOf(incidentRaw);
  if (!incident) return INCIDENT_NOT_FOUND;
  if (messageRaw !== undefined && typeof messageRaw !== "string") {
    return bad("The closing message must be text.", "message");
  }
  const message = typeof messageRaw === "string" ? messageRaw.trim() : "";
  if (message.length > MESSAGE_MAX) {
    return bad(`Use ${MESSAGE_MAX} characters or fewer.`, "message");
  }
  const result = await runStaffAction("incident_run", {}, async (ctx) => {
    const r = await staffResolveIncident(ctx, {
      incident,
      ...(message ? { message } : {}),
    });
    const line = `Resolved ${r.code}. ${plural(r.moved, "linked ticket")} moved to Resolved, ${plural(r.alerts, "alert")} raised.`;
    return {
      message:
        r.skipped > 0
          ? `${line} ${plural(r.skipped, "ticket")} could not move; resolve again after fixing.`
          : line,
      moved: r.moved,
      alerts: r.alerts,
      skipped: r.skipped,
    };
  });
  if (result.ok) refresh();
  return result;
}

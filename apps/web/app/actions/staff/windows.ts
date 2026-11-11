"use server";
// Service-window actions (13-36 choice 3; STAFF-10, STAFF-11, D99-D102; T-13-36-01, T-13-36-02).
// Public POST endpoints: every argument is untrusted. Thin callers of the functions the
// `service:window` CLI calls:
//   create -> staffCreateServiceWindow  (organization / page / component: service_window_org;
//                                        platform / add-on: service_window_platform + step-up)
//   clear  -> staffClearServiceWindow   (platform / add-on windows: super_admin + step-up)
//   list   -> staffListServiceWindows   (the panel reads it directly)
// The feature is picked from the scope before anything runs, so an agent asking for a
// platform window is refused REFUSED-ROLE and the db function is never called; @cds/db checks
// the matrix again. The console asks for less than the db allows (7 days, 160 characters;
// WINDOW-RANGE) and checks it here too. Result lines mirror the CLI. Errors are logged by
// class name only.
import { ADDON_REGISTRY } from "@cds/addon-registry";
import { InvalidInput } from "@cds/core";
import { P13_COPY } from "@cds/core/staff";
import {
  isWideWindowScope,
  WINDOW_MESSAGE_MAX,
  WINDOW_SCOPES,
  windowCreatedLine,
  windowRangeOk,
  type WindowScope,
} from "@cds/core/support";
import {
  staffClearServiceWindow,
  staffCreateServiceWindow,
  staffListIncidents,
  staffListServiceWindows,
  staffSupportLabels,
  staffWindowTargets,
  type PlatformContext,
  type ServiceWindowInput,
} from "@cds/db";
import { revalidatePath } from "next/cache";
import {
  errorName,
  runStaffAction,
  type ActionResult,
} from "../../../lib/staff-action";

type Failure = Extract<ActionResult<never>, { ok: false }>;

const ID_RE = /^[a-z0-9]{15}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const INCIDENT_RE = /^I-[1-9]\d{0,8}$/i;
const WINDOW_RE = /^W-[1-9]\d{0,8}$/i;
const ISO_MAX = 40;

const NOT_FOUND: Failure = {
  ok: false,
  code: "not_found",
  message: "That window wasn't found.",
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

function idOrUndefined(v: unknown): string | undefined | null {
  if (v === undefined || v === "") return undefined;
  return typeof v === "string" && ID_RE.test(v) ? v : null;
}

function instant(v: unknown): Date | null {
  if (typeof v !== "string" || v.length > ISO_MAX) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t) : null;
}

function knownAddons(): { slug: string; name: string }[] {
  return ADDON_REGISTRY.list().map((m) => ({ slug: m.slug, name: m.name }));
}

function refresh(): void {
  try {
    revalidatePath("/staff", "layout");
  } catch (err) {
    console.error("[staff windows] revalidate failed", errorName(err));
  }
}

/** Labels for the result line; best effort (a failed read never fails the write). */
async function labelsFor(
  ctx: PlatformContext,
  orgId: string,
  pageId: string,
): Promise<{ orgs: Record<string, string>; pages: Record<string, string> }> {
  if (!orgId) return { orgs: {}, pages: {} };
  try {
    return await staffSupportLabels(ctx, {
      orgIds: [orgId],
      pageIds: pageId ? [pageId] : [],
    });
  } catch (err) {
    console.error("[staff windows] labels read failed", errorName(err));
    return { orgs: {}, pages: {} };
  }
}

/**
 * Create a planned-work window (UI-SPEC "Service windows" 1-7). `input` = `{ scope, orgId?,
 * pageId?, component?, addon?, startsAt (ISO), endsAt (ISO), message, incident? ("I-3") }`.
 * Returns the CLI line "Window W-12 · Rivera Bakery · page "About us" · now → 4:00 pm Central ·
 * editing paused for the owner." plus the code and how many alerts a started wide window raised.
 */
export async function createWindowAction(
  input: unknown,
): Promise<ActionResult<{ message: string; code: string; alerted: number }>> {
  const scope = own(input, "scope");
  if (
    typeof scope !== "string" ||
    !(WINDOW_SCOPES as readonly string[]).includes(scope)
  ) {
    return bad("Choose a scope.", "scope");
  }
  const s = scope as WindowScope;
  const wide = isWideWindowScope(s);
  const orgId = idOrUndefined(own(input, "orgId"));
  const pageId = idOrUndefined(own(input, "pageId"));
  if (orgId === null || pageId === null)
    return bad("Choose a target.", "target");
  const needsOrg = s === "organization" || s === "page" || s === "component";
  if (needsOrg && !orgId) return bad("Choose a site.", "target");
  if (s === "page" && !pageId) return bad("Choose a page.", "target");
  const componentRaw = own(input, "component");
  const component =
    s === "component" && typeof componentRaw === "string"
      ? componentRaw.trim().toLowerCase()
      : "";
  if (s === "component" && !SLUG_RE.test(component)) {
    return bad("Choose a part.", "target");
  }
  const addonRaw = own(input, "addon");
  const addon = s === "addon" && typeof addonRaw === "string" ? addonRaw : "";
  if (s === "addon" && !SLUG_RE.test(addon)) {
    return bad("Choose an add-on.", "target");
  }
  const messageRaw = own(input, "message");
  const message = typeof messageRaw === "string" ? messageRaw.trim() : "";
  if (!message) return bad("Add a message owners will see.", "message");
  if (message.length > WINDOW_MESSAGE_MAX) {
    return bad(`Use ${WINDOW_MESSAGE_MAX} characters or fewer.`, "message");
  }
  const startsAt = instant(own(input, "startsAt"));
  const endsAt = instant(own(input, "endsAt"));
  const incidentRaw = own(input, "incident");
  if (
    incidentRaw !== undefined &&
    incidentRaw !== "" &&
    (typeof incidentRaw !== "string" || !INCIDENT_RE.test(incidentRaw))
  ) {
    return bad("Choose an open incident.", "incident");
  }
  const incidentCode =
    typeof incidentRaw === "string" && incidentRaw
      ? `I-${incidentRaw.slice(2)}`
      : "";

  const result = await runStaffAction(
    wide ? "service_window_platform" : "service_window_org",
    { stepUp: wide },
    async (ctx) => {
      const now = new Date();
      // Checked against the server clock: the browser's may drift.
      if (!windowRangeOk(startsAt, endsAt, now)) {
        throw new InvalidInput(P13_COPY.WINDOW_RANGE);
      }
      const win: ServiceWindowInput = {
        scope: s,
        message,
        startsAt: startsAt!.getTime() < now.getTime() ? now : startsAt!,
        endsAt: endsAt!,
        ...(orgId ? { orgId } : {}),
        ...(pageId && s === "page" ? { pageId } : {}),
        ...(component ? { component } : {}),
        ...(addon ? { addon } : {}),
      };
      if (incidentCode) {
        const hit = (await staffListIncidents(ctx)).find(
          (i) => i.code === incidentCode,
        );
        if (!hit) throw new InvalidInput("Choose an open incident.");
        win.incident = hit.id;
      }
      const addons = knownAddons();
      const r = await staffCreateServiceWindow(ctx, win, {
        clock: { now: () => now },
        addons,
        notify: {},
      });
      const labels = await labelsFor(ctx, orgId ?? "", pageId ?? "");
      const line = windowCreatedLine(
        r.code,
        {
          scope: s,
          orgId: orgId ?? "",
          addon,
          page: s === "page" ? (pageId ?? "") : "",
          component,
        },
        { ...labels, addons },
        { start: win.startsAt!, end: win.endsAt, now },
      );
      return {
        message:
          r.alerted > 0
            ? `${line} ${r.alerted} alert${r.alerted === 1 ? "" : "s"} raised.`
            : line,
        code: r.code,
        alerted: r.alerted,
      };
    },
  );
  if (!result.ok && result.message === P13_COPY.WINDOW_RANGE) {
    return { ...result, field: "range" };
  }
  if (result.ok) refresh();
  return result;
}

/**
 * End a window now ("End W-12 now?" → End now). Platform and add-on windows need super_admin
 * and a fresh step-up; the scope is read first so the right gate applies.
 */
export async function endWindowAction(
  codeRaw: unknown,
): Promise<ActionResult<{ message: string; code: string; cleared: boolean }>> {
  if (typeof codeRaw !== "string" || !WINDOW_RE.test(codeRaw.trim())) {
    return NOT_FOUND;
  }
  const code = `W-${codeRaw.trim().slice(2)}`;
  const found = await runStaffAction("service_window_org", {}, async (ctx) => {
    const rows = await staffListServiceWindows(ctx, { includeEnded: true });
    return rows.find((r) => r.code === code)?.scope ?? null;
  });
  if (!found.ok) return found;
  if (found.data === null) return NOT_FOUND;
  const wide = isWideWindowScope(found.data);
  const result = await runStaffAction(
    wide ? "service_window_platform" : "service_window_org",
    { stepUp: wide },
    async (ctx) => {
      const r = await staffClearServiceWindow(ctx, { code });
      return {
        message: r.cleared
          ? `Cleared ${r.code}. Editing is back on; the notice is gone.`
          : `${r.code} had already ended; nothing changed.`,
        code: r.code,
        cleared: r.cleared,
      };
    },
  );
  if (result.ok && result.data.cleared) refresh();
  return result;
}

/** The Target pickers for one site: its pages and its active add-ons (with names). */
export async function windowTargetsAction(orgIdRaw: unknown): Promise<
  ActionResult<{
    pages: { id: string; title: string }[];
    addons: { slug: string; name: string }[];
  }>
> {
  if (typeof orgIdRaw !== "string" || !ID_RE.test(orgIdRaw)) {
    return { ok: false, code: "not_found", message: "That site wasn't found." };
  }
  return runStaffAction("service_window_org", {}, async (ctx) => {
    const t = await staffWindowTargets(ctx, orgIdRaw);
    const names = new Map(knownAddons().map((a) => [a.slug, a.name]));
    return {
      pages: t.pages.map((p) => ({ id: p.id, title: p.title })),
      addons: t.activeAddons.map((slug) => ({
        slug,
        name: names.get(slug) ?? slug,
      })),
    };
  });
}

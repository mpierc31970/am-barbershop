// Service windows from the terminal (12-30; COMM-11; D99-D102; UI-SPEC "Staff CLI output").
// `create` a planned-work window, `list` them, `clear` one early, through
// staffCreateServiceWindow / staffListServiceWindows / staffClearServiceWindow after a CDS staff
// sign-in with the emailed code. D100 role split: organization, page and component windows need
// super_admin or support_agent; platform and add-on windows need super_admin, and a
// support_agent is refused with a plain sentence before anything is written (T-12-30-01; the db
// function enforces it too). Every create and clear is audited with the staff actor.
//
// Usage:
//   npm run service:window -- create --scope platform|addon|organization|page|component
//        [--org <id>] [--addon <slug>] [--page <id>] [--component header|footer|menus|<slug>]
//        [--from <ISO|HH:MM>] --until <ISO|HH:MM> --message "<text>" [--incident I-3]
//        [--yes] [--dry-run]
//   npm run service:window -- list [--all] [--dry-run]
//   npm run service:window -- clear --id W-12 [--dry-run]
//   npm run service:window -- --help
// HH:MM is America/Chicago (business time). Env: PB_URL, PB_SUPERUSER_EMAIL,
// PB_SUPERUSER_PASSWORD (required; .env.local is read by the npm script).
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import "@cds/addon-registry/server";
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import { BUSINESS_TIME_ZONE } from "@cds/core/payments";
import {
  businessWall,
  businessWallToUtc,
  formatNoticeEnd,
  SITE_PARTS,
  WINDOW_SCOPES,
  type WindowScope,
} from "@cds/core/support";
import type { EmailTransport } from "../src/email/transport";
import { staffListIncidents } from "../src/support/incidents";
import { staffSupportLabels } from "../src/support/staff-labels";
import {
  staffClearServiceWindow,
  staffCreateServiceWindow,
  staffListServiceWindows,
  type KnownAddon,
  type ServiceWindowInput,
  type ServiceWindowView,
} from "../src/support/windows";
import {
  ask,
  CliFail,
  fail,
  ORG_RE,
  parseArgs,
  runMain,
  safeText,
  signInStaffInteractive,
  table,
  wantsHelp,
  type ParsedArgs,
} from "./staff-cli";

export const REFUSED_PLATFORM =
  "Refused: platform and add-on windows need super_admin.";
const MESSAGE_MAX = 280;
const TZ = BUSINESS_TIME_ZONE;

export const USAGE = `service:window - planned-work windows that pause editing and show a notice (super_admin or support_agent)

  npm run service:window -- create --scope <scope> [--org <org-id>] [--addon <slug>]
       [--page <page-id>] [--component header|footer|menus|<addon-slug>]
       [--from <ISO|HH:MM>] --until <ISO|HH:MM> --message "<text>" [--incident I-3]
       [--yes] [--dry-run]
  npm run service:window -- list [--all] [--dry-run]
  npm run service:window -- clear --id W-12 [--dry-run]
  npm run service:window -- --help

create      --scope platform (every site), addon (every site with --addon on),
            organization (one site: --org), page (--org and --page) or component
            (--org and --component). Platform and add-on windows need super_admin.
            --from defaults to now; --until is required; a window lasts at most 14 days.
            HH:MM is ${TZ} today (--until rolls to tomorrow when it is already past).
            --message: up to ${MESSAGE_MAX} characters, shown to owners in the notice.
            --incident links a known problem (I-3) whose public text the notice shows.
            Asks "Create? [y/N]" (--yes skips). A window that has started and covers a
            whole site or more alerts the Owners, Admins and Editors it reaches.
list        windows not yet ended, soonest first; --all includes ended and cleared ones
clear       end a window now (--id W-12)
--dry-run   create and clear: sign in and print what would change, without writing;
            list: check the arguments only
Prompts for staff email, password and the emailed sign-in code.
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)`;

export type WindowDeps = {
  now?: () => Date;
  /** Known add-ons (slug + name); defaults to the add-on registry. */
  addons?: readonly KnownAddon[];
  transport?: EmailTransport;
};

// ---------------------------------------------------------------------------------------
// Times

// Wall time lives in @cds/core/support (13-36 choice 2) so the console presets share it.
const wall = (t: number) => businessWall(t, TZ);
const wallToUtc = (y: number, m: number, d: number, h: number, min: number) =>
  businessWallToUtc(y, m, d, h, min, TZ);

/** ISO date-time, or HH:MM today in business time. */
export function timeArg(
  raw: string,
  flag: string,
  now: Date,
): {
  at: Date;
  clock: boolean;
} {
  const v = raw.trim();
  const hm = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(v);
  if (hm) {
    const today = wall(now.getTime());
    return {
      at: wallToUtc(today.y, today.m, today.d, Number(hm[1]), Number(hm[2])),
      clock: true,
    };
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
    fail(`${flag} must be an ISO date-time (2026-10-16T21:00-05:00) or HH:MM`);
  }
  const t = Date.parse(v);
  if (!Number.isFinite(t)) fail(`${flag} is not a valid date-time`);
  return { at: new Date(t), clock: false };
}

const DAY_MS = 24 * 3_600_000;

// ---------------------------------------------------------------------------------------
// Output

type Labels = {
  orgs: Record<string, string>;
  pages: Record<string, string>;
  addons: readonly KnownAddon[];
};

function addonName(slug: string, addons: readonly KnownAddon[]): string {
  return addons.find((a) => a.slug === slug)?.name ?? slug;
}

/** "Rivera Bakery · page "About us"", "all sites", "add-on "Testimonials"". */
export function targetText(
  w: Pick<
    ServiceWindowView,
    "scope" | "orgId" | "addon" | "page" | "component"
  >,
  labels: Labels,
): string {
  const business = safeText(labels.orgs[w.orgId] || w.orgId || "?");
  switch (w.scope) {
    case "platform":
      return "all sites";
    case "addon":
      return `add-on "${safeText(addonName(w.addon, labels.addons))}" on every site that has it`;
    case "organization":
      return business;
    case "page":
      return `${business} · page "${safeText(labels.pages[w.page] || w.page)}"`;
    case "component": {
      const part = SITE_PARTS.find((p) => p.key === w.component);
      const name = part
        ? part.label.toLowerCase()
        : `add-on "${safeText(addonName(w.component, labels.addons))}"`;
      return `${business} · ${name}`;
    }
    default:
      return business;
  }
}

function effect(scope: WindowScope, started: boolean): string {
  const verb = started ? "editing paused" : "editing pauses then";
  return scope === "platform" || scope === "addon"
    ? `${verb} for the owners`
    : `${verb} for the owner`;
}

/** "now → 4:00 pm America/Chicago" or "Thu 16 Oct at 9:00 pm → 11:00 pm …". */
function spanText(start: Date, end: Date, now: Date): string {
  const from =
    start.getTime() <= now.getTime() ? "now" : formatNoticeEnd(start, now, TZ);
  return `${from} → ${formatNoticeEnd(end, now, TZ)} ${TZ}`;
}

// ---------------------------------------------------------------------------------------
// Verbs

function refusal(err: unknown, doing: string): never {
  if (err instanceof Forbidden) {
    throw new CliFail(`This account can't ${doing}.`, { plain: true });
  }
  if (err instanceof NotFound) {
    throw new CliFail(`Not found: ${err.message || "no such window"}.`, {
      plain: true,
    });
  }
  if (err instanceof InvalidInput) {
    throw new CliFail(`Refused: ${err.message}`, { plain: true });
  }
  throw err;
}

function idArg(
  args: ParsedArgs,
  flag: string,
  what: string,
): string | undefined {
  const v = args.get(flag);
  if (v === undefined) return undefined;
  if (typeof v !== "string" || !ORG_RE.test(v))
    fail(`${flag} is not a valid ${what} id`);
  return v;
}

async function create(
  argv: readonly string[],
  deps: WindowDeps,
): Promise<void> {
  const args = parseArgs(argv, {
    known: [
      "--scope",
      "--org",
      "--addon",
      "--page",
      "--component",
      "--from",
      "--until",
      "--message",
      "--incident",
      "--yes",
      "--dry-run",
    ],
    withValue: [
      "--scope",
      "--org",
      "--addon",
      "--page",
      "--component",
      "--from",
      "--until",
      "--message",
      "--incident",
    ],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }
  const scopeRaw = args.get("--scope");
  if (typeof scopeRaw !== "string") fail("--scope is required");
  const scope = scopeRaw.trim().toLowerCase() as WindowScope;
  if (!(WINDOW_SCOPES as readonly string[]).includes(scope)) {
    fail(`--scope must be ${WINDOW_SCOPES.join(", ")}`);
  }
  const org = idArg(args, "--org", "organization");
  const page = idArg(args, "--page", "page");
  const addonRaw = args.get("--addon");
  const componentRaw = args.get("--component");
  const needsOrg =
    scope === "organization" || scope === "page" || scope === "component";
  if (needsOrg && !org) fail(`--scope ${scope} needs --org <org-id>`);
  if (!needsOrg && org) fail(`--org does not go with --scope ${scope}`);
  if (scope === "page" && !page) fail("--scope page needs --page <page-id>");
  if (scope !== "page" && page) fail("--page goes with --scope page");
  if (scope === "addon" && typeof addonRaw !== "string") {
    fail("--scope addon needs --addon <slug>");
  }
  if (scope !== "addon" && addonRaw !== undefined)
    fail("--addon goes with --scope addon");
  if (scope === "component" && typeof componentRaw !== "string") {
    fail(
      "--scope component needs --component header|footer|menus|<addon-slug>",
    );
  }
  if (scope !== "component" && componentRaw !== undefined) {
    fail("--component goes with --scope component");
  }
  const message = args.get("--message");
  if (typeof message !== "string" || message.trim() === "") {
    fail('--message "<text>" is required');
  }
  if (message.trim().length > MESSAGE_MAX) {
    fail(`--message must be at most ${MESSAGE_MAX} characters`);
  }
  const untilRaw = args.get("--until");
  if (typeof untilRaw !== "string") fail("--until <ISO|HH:MM> is required");
  const fromRaw = args.get("--from");
  const incidentRaw = args.get("--incident");
  let incidentCode: string | undefined;
  if (typeof incidentRaw === "string") {
    const m = /^I-([1-9]\d{0,8})$/i.exec(incidentRaw.trim());
    if (!m) fail("--incident must be an incident code such as I-3");
    incidentCode = `I-${m[1]}`;
  }

  const now = (deps.now ?? (() => new Date()))();
  const start =
    typeof fromRaw === "string" ? timeArg(fromRaw, "--from", now).at : now;
  const until = timeArg(untilRaw, "--until", now);
  let end = until.at;
  // HH:MM already past (or before the start) means that time tomorrow.
  const floor = Math.max(start.getTime(), now.getTime());
  if (until.clock && end.getTime() <= floor)
    end = new Date(end.getTime() + DAY_MS);
  if (end.getTime() <= start.getTime()) fail("--until must be after --from");
  if (end.getTime() <= now.getTime()) fail("--until must be in the future");

  const ctx = await signInStaffInteractive();
  if (
    (scope === "platform" || scope === "addon") &&
    ctx.staffRole !== "super_admin"
  ) {
    throw new CliFail(REFUSED_PLATFORM, { plain: true });
  }
  const addons = deps.addons ?? registryAddons();
  const input: ServiceWindowInput = {
    scope,
    message: message.trim(),
    endsAt: end,
    ...(typeof fromRaw === "string" ? { startsAt: start } : {}),
    ...(org ? { orgId: org } : {}),
    ...(page ? { pageId: page } : {}),
    ...(typeof addonRaw === "string" ? { addon: addonRaw.trim() } : {}),
    ...(typeof componentRaw === "string"
      ? { component: componentRaw.trim().toLowerCase() }
      : {}),
  };
  let labels: Labels;
  try {
    if (incidentCode) {
      const incidents = await staffListIncidents(ctx, {
        includeResolved: true,
      });
      const hit = incidents.find((i) => i.code === incidentCode);
      if (!hit) throw new NotFound(`no incident ${incidentCode}`);
      if (hit.status === "resolved") {
        throw new InvalidInput(`${incidentCode} is already resolved`);
      }
      input.incident = hit.id;
    }
    const l = await staffSupportLabels(ctx, {
      orgIds: org ? [org] : [],
      pageIds: page ? [page] : [],
    });
    if (org && !(org in l.orgs)) throw new NotFound("no site with that id");
    labels = { ...l, addons };
  } catch (err) {
    refusal(err, "create service windows");
  }

  const view = {
    scope,
    orgId: org ?? "",
    addon: input.addon ?? "",
    page: page ?? "",
    component: input.component ?? "",
  };
  const started = start.getTime() <= now.getTime();
  const summary = `${targetText(view, labels)} · ${spanText(start, end, now)} · ${effect(scope, started)}.`;
  console.log(`New window: ${summary}`);
  console.log(`  Notice message: ${safeText(input.message ?? "")}`);
  if (incidentCode) console.log(`  Linked to ${incidentCode}`);
  if (args.has("--dry-run")) {
    console.log("DRY RUN would create this window; nothing changed");
    return;
  }
  if (!args.has("--yes")) {
    const answer = await ask("Create? [y/N] ");
    if (!/^y(es)?$/i.test(answer)) {
      console.log("Nothing changed.");
      return;
    }
  }
  try {
    const r = await staffCreateServiceWindow(ctx, input, {
      clock: { now: () => now },
      addons,
      notify: { transport: deps.transport },
    });
    console.log(`Window ${r.code} · ${summary}`);
    if (r.alerted > 0) {
      console.log(`${r.alerted} alert${r.alerted === 1 ? "" : "s"} raised.`);
    }
  } catch (err) {
    if (
      err instanceof Forbidden &&
      (scope === "platform" || scope === "addon")
    ) {
      throw new CliFail(REFUSED_PLATFORM, { plain: true });
    }
    refusal(err, "create service windows");
  }
}

function registryAddons(): KnownAddon[] {
  return ADDON_REGISTRY.list().map((m) => ({ slug: m.slug, name: m.name }));
}

async function list(argv: readonly string[], deps: WindowDeps): Promise<void> {
  const args = parseArgs(argv, {
    known: ["--all", "--dry-run"],
    withValue: [],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }
  if (args.has("--dry-run")) {
    console.log("DRY RUN arguments are fine; nothing read");
    return;
  }
  const ctx = await signInStaffInteractive();
  const now = (deps.now ?? (() => new Date()))();
  let rows: ServiceWindowView[];
  let labels: Labels;
  try {
    rows = await staffListServiceWindows(
      ctx,
      { includeEnded: args.has("--all") },
      { now: () => now },
    );
    const l = await staffSupportLabels(ctx, {
      orgIds: rows.map((r) => r.orgId).filter(Boolean),
      pageIds: rows.map((r) => r.page).filter(Boolean),
    });
    labels = { ...l, addons: deps.addons ?? registryAddons() };
  } catch (err) {
    refusal(err, "list service windows");
  }
  if (rows.length === 0) {
    console.log(
      args.has("--all") ? "No windows." : "No windows now or coming up.",
    );
    return;
  }
  const phase = (r: ServiceWindowView) =>
    r.clearedAt ? "cleared" : r.phase === "later" ? "planned" : r.phase;
  console.log(
    table(
      ["Window", "Scope", "Target", "When", "State", "Message"],
      rows.map((r) => [
        r.code,
        r.scope,
        targetText(r, labels),
        spanText(
          new Date(r.startsAt.replace(" ", "T")),
          new Date(r.endsAt.replace(" ", "T")),
          now,
        ),
        phase(r),
        r.message.length > 50 ? `${r.message.slice(0, 49)}…` : r.message,
      ]),
    ),
  );
  console.log(`${rows.length} window${rows.length === 1 ? "" : "s"}`);
}

async function clear(argv: readonly string[], deps: WindowDeps): Promise<void> {
  const args = parseArgs(argv, {
    known: ["--id", "--dry-run"],
    withValue: ["--id"],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }
  const raw = args.get("--id");
  if (typeof raw !== "string") fail("--id W-12 is required");
  const m = /^W-([1-9]\d{0,8})$/i.exec(raw.trim());
  if (!m) fail("--id must be a window code such as W-12");
  const code = `W-${m[1]}`;
  const ctx = await signInStaffInteractive();
  const now = (deps.now ?? (() => new Date()))();
  if (args.has("--dry-run")) {
    let rows: ServiceWindowView[];
    try {
      rows = await staffListServiceWindows(
        ctx,
        { includeEnded: true },
        { now: () => now },
      );
    } catch (err) {
      refusal(err, "clear service windows");
    }
    const hit = rows.find((r) => r.code === code);
    if (!hit)
      throw new CliFail(`Not found: no window ${code}.`, { plain: true });
    if (
      (hit.scope === "platform" || hit.scope === "addon") &&
      ctx.staffRole !== "super_admin"
    ) {
      throw new CliFail(REFUSED_PLATFORM, { plain: true });
    }
    console.log(`DRY RUN would end ${code} now; nothing changed`);
    return;
  }
  try {
    const r = await staffClearServiceWindow(ctx, { code }, { now: () => now });
    console.log(
      r.cleared
        ? `Cleared ${r.code}. Editing is back on; the notice is gone.`
        : `${r.code} had already ended; nothing changed.`,
    );
  } catch (err) {
    if (err instanceof Forbidden && ctx.staffRole !== "super_admin") {
      throw new CliFail(REFUSED_PLATFORM, { plain: true });
    }
    if (err instanceof NotFound) {
      throw new CliFail(`Not found: no window ${code}.`, { plain: true });
    }
    refusal(err, "clear service windows");
  }
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  deps: WindowDeps = {},
): Promise<void> {
  const verb = argv[0];
  if (verb === undefined || verb === "--help" || verb === "-h") {
    console.log(USAGE);
    if (verb === undefined) fail("give a verb: create, list or clear");
    return;
  }
  const rest = argv.slice(1);
  if (verb === "create") return create(rest, deps);
  if (verb === "list") return list(rest, deps);
  if (verb === "clear") return clear(rest, deps);
  console.log(USAGE);
  fail(`unknown verb ${verb.slice(0, 40)}: use create, list or clear`);
}

// Exported for tests; runs only when executed directly (node … service-window.ts).
const entry = process.argv[1];
if (
  entry &&
  resolve(entry).toLowerCase() ===
    resolve(fileURLToPath(import.meta.url)).toLowerCase()
) {
  runMain(() => main());
}

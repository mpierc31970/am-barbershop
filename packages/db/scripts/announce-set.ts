// Staff platform announcement (11-42; DASH-23; UI-SPEC "Staff CLI output"). Sets the one
// CDS-wide announcement owners see in From CDS on Today, through setAnnouncement (ends any
// active one in the same batch; audited platform.announcement_set), or ends it with --clear
// through clearAnnouncement (audited platform.announcement_cleared). super_admin only
// (announce_set), after a CDS staff sign-in with the emailed code (T-11-42-02).
//
// Usage:
//   npm run announce:set -- --title "<text>" [--body "<text>"] [--href <https-url|/hub/...>]
//        [--paths <path,...>] [--days 14] [--dry-run] [--yes]
//   npm run announce:set -- --clear [--dry-run]
//   npm run announce:set -- --help
// --dry-run still signs in (announcements are staff-only) but writes nothing.
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by
// the npm script). Credentials and codes are never printed.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Forbidden, InvalidInput } from "@cds/core";
import { ADDON_PATHS, type AddonPath } from "@cds/core/addons";
import {
  clearAnnouncement,
  isSafeAnnouncementHref,
  setAnnouncement,
} from "../src/today/announcements";
import {
  ask,
  CliFail,
  fail,
  parseArgs,
  runMain,
  safeText,
  signInStaffInteractive,
  wantsHelp,
} from "./staff-cli";

export const TITLE_MAX = 80;
export const BODY_MAX = 280;
export const DAYS_DEFAULT = 14;
export const DAYS_MAX = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const ZONE = "America/Chicago";
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const USAGE = `announce:set - set or clear the announcement owners see in From CDS on Today (super_admin)

  npm run announce:set -- --title "<text>" [--body "<text>"] [--href <link>] [--paths <path,...>] [--days ${DAYS_DEFAULT}] [--dry-run] [--yes]
  npm run announce:set -- --clear [--dry-run]
  npm run announce:set -- --help

--title    the card's heading (1-${TITLE_MAX} characters)
--body     one or two sentences under it (up to ${BODY_MAX} characters)
--href     optional link: https://... or a hub path such as /hub/add-ons
--paths    which sites see it, comma-separated: ${ADDON_PATHS.join(", ")} (default: every site)
--days     how long it shows, 1-${DAYS_MAX} days from now (default ${DAYS_DEFAULT})
--clear    end the announcement showing now
--dry-run  sign in and print the card as owners will see it, without writing
--yes      skip the y/N confirm
Setting a new announcement ends the one showing now: owners see one at a time.
Prompts for staff email, password and the emailed sign-in code.
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)`;

/** "31 Oct" in CDS's time zone (no "Sept"). */
export function dayMonth(d: Date, zone = ZONE): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      month: "numeric",
      day: "numeric",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${Number(parts.day)} ${MONTHS[Number(parts.month) - 1]}`;
}

export type AnnouncementPlan = {
  title: string;
  body: string;
  href: string;
  paths: AddonPath[];
  days: number;
};

/** The card as owners see it in From CDS, plus who sees it and until when. */
export function previewLines(plan: AnnouncementPlan, endsAt: Date): string[] {
  const lines = ["From CDS", `  ${safeText(plan.title)}`];
  if (plan.body) lines.push(`  ${safeText(plan.body)}`);
  if (plan.href) lines.push(`  Link: ${safeText(plan.href)}`);
  lines.push(
    `Shown to:  ${plan.paths.length === 0 ? "every site" : `${plan.paths.join(" and ")} sites`}`,
  );
  lines.push(
    `Until:     ${dayMonth(endsAt)} (${plan.days} day${plan.days === 1 ? "" : "s"})`,
  );
  return lines;
}

function parsePaths(raw: string): AddonPath[] {
  const out = new Set<AddonPath>();
  for (const part of raw.split(",")) {
    const p = part.trim().toLowerCase();
    if (!(ADDON_PATHS as readonly string[]).includes(p)) {
      fail(
        `--paths must be one or more of ${ADDON_PATHS.join(", ")}, comma-separated`,
      );
    }
    out.add(p as AddonPath);
  }
  return [...out];
}

function refused(err: unknown): never {
  if (err instanceof Forbidden) {
    throw new CliFail("Refused: setting announcements needs super_admin.", {
      plain: true,
    });
  }
  if (err instanceof InvalidInput) {
    throw new CliFail(`Refused: ${err.message}`, { plain: true });
  }
  throw err;
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  clock: () => Date = () => new Date(),
): Promise<void> {
  const args = parseArgs(argv, {
    known: [
      "--title",
      "--body",
      "--href",
      "--paths",
      "--days",
      "--clear",
      "--dry-run",
      "--yes",
    ],
    withValue: ["--title", "--body", "--href", "--paths", "--days"],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }

  if (args.has("--clear")) {
    for (const f of ["--title", "--body", "--href", "--paths", "--days"]) {
      if (args.has(f)) fail(`--clear can't be combined with ${f}`);
    }
    const ctx = await signInStaffInteractive();
    if (args.has("--dry-run")) {
      console.log(
        "DRY RUN would end the announcement showing now; nothing changed",
      );
      return;
    }
    try {
      const r = await clearAnnouncement(ctx);
      console.log(
        r.ended.length === 0
          ? "No announcement was showing. Nothing changed."
          : "Announcement ended. From CDS shows no announcement now.",
      );
    } catch (err) {
      refused(err);
    }
    return;
  }

  // Everything is checked before anyone signs in.
  const rawTitle = args.get("--title");
  if (typeof rawTitle !== "string") {
    fail('--title "<text>" is required (or --clear)');
  }
  const title = rawTitle.trim();
  if (title === "" || title.length > TITLE_MAX) {
    fail(`--title must be 1-${TITLE_MAX} characters`);
  }
  const rawBody = args.get("--body");
  const body = typeof rawBody === "string" ? rawBody.trim() : "";
  if (body.length > BODY_MAX) {
    fail(`--body must be at most ${BODY_MAX} characters`);
  }
  if (/[\r\n]/.test(title)) fail("--title must be one line");
  const rawHref = args.get("--href");
  const href = typeof rawHref === "string" ? rawHref.trim() : "";
  if (href !== "" && !isSafeAnnouncementHref(href)) {
    fail("--href must be https://... or a /hub/ path");
  }
  const rawPaths = args.get("--paths");
  const paths = typeof rawPaths === "string" ? parsePaths(rawPaths) : [];
  const rawDays = args.get("--days");
  let days = DAYS_DEFAULT;
  if (rawDays !== undefined) {
    if (typeof rawDays !== "string" || !/^\d{1,2}$/.test(rawDays)) {
      fail(`--days must be a whole number 1-${DAYS_MAX}`);
    }
    days = Number(rawDays);
    if (days < 1 || days > DAYS_MAX) {
      fail(`--days must be a whole number 1-${DAYS_MAX}`);
    }
  }
  const plan: AnnouncementPlan = { title, body, href, paths, days };

  const ctx = await signInStaffInteractive();
  const now = clock();
  const endsAt = new Date(now.getTime() + days * DAY_MS);
  for (const line of previewLines(plan, endsAt)) console.log(line);
  if (args.has("--dry-run")) {
    console.log("DRY RUN would publish this announcement; nothing changed");
    return;
  }
  if (!args.has("--yes")) {
    const answer = await ask("Publish? [y/N] ");
    if (!/^y(es)?$/i.test(answer)) {
      console.log("Nothing changed.");
      return;
    }
  }
  try {
    await setAnnouncement(
      ctx,
      { title, body, href, paths, startsAt: now, endsAt },
      { now: () => now },
    );
  } catch (err) {
    refused(err);
  }
  console.log(
    `Announcement live until ${dayMonth(endsAt)}. Owners see it in From CDS.`,
  );
}

// Exported for tests; runs only when executed directly (node … announce-set.ts).
const entry = process.argv[1];
if (
  entry &&
  resolve(entry).toLowerCase() ===
    resolve(fileURLToPath(import.meta.url)).toLowerCase()
) {
  runMain(() => main());
}

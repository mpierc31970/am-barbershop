// Staff stage and build note (11-42; DASH-02, DASH-30, DASH-33; D312; D-UI-P11-27; UI-SPEC
// "Staff CLI output"). Moves an org's stage forward through setOrgStage (the one stage
// transition: forward only, audited org.stage_changed, raises the team's site.stage alert at
// ready_for_review and live) and sets or clears the "What CDS is doing now" note through
// setBuildNote (audited org.build_note_set). P13's staff console uses the same chokepoints.
// --to is super_admin only (org_stage); support_agent may set the note only (build_note)
// (T-11-42-01). Staff email, password and the emailed code first (T-11-42-02).
//
// Usage:
//   npm run org:stage -- --org <org-id> [--to <stage>] [--build-note "<text>" | --clear-note]
//        [--dry-run] [--yes]
//   npm run org:stage -- --help
// With neither --to nor a note flag it prints the org's stage and note and changes nothing.
// --dry-run still signs in (the org's state is staff-only) but writes nothing.
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by
// the npm script). Credentials and codes are never printed.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import {
  BUILD_NOTE_MAX,
  isOrgStage,
  ORG_STAGES,
  setBuildNote,
  setOrgStage,
  staffOrgStage,
  type OrgStage,
} from "../src/org-stage";
import { staffHasLaunchMove } from "../src/staff/pipeline";
import type { PlatformContext } from "../src/context";
import {
  ask,
  CliFail,
  fail,
  ORG_RE,
  parseArgs,
  runMain,
  safeText,
  signInStaffInteractive,
  wantsHelp,
} from "./staff-cli";

const USAGE = `org:stage - move a site's stage forward and set the "What CDS is doing now" note

  npm run org:stage -- --org <org-id> [--to <stage>] [--build-note "<text>" | --clear-note] [--dry-run] [--yes]
  npm run org:stage -- --help

--org         the site's organization id
--to          the new stage (super_admin only), forward only:
              ${ORG_STAGES.join(" < ")}
              live is final and sets the launch date
--build-note  the note the owner reads on Today while CDS builds (1-${BUILD_NOTE_MAX} characters, one line;
              super_admin or support_agent)
--clear-note  remove the note (Today shows the default line again)
--dry-run     sign in and print the planned change, without writing
--yes         skip the y/N confirm before a stage move
With neither --to nor a note flag it prints the current stage and note.
Prompts for staff email, password and the emailed sign-in code.
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)`;

/** What the owner sees on Today once the stage is set (D312, tracker labels). */
export const OWNER_SEES: Readonly<Record<Exclude<OrgStage, "">, string>> =
  Object.freeze({
    intake: "Set up your site",
    fit_review: "Set up your site",
    ready_for_build: "Received",
    being_built: "CDS polishing",
    ready_for_review: "Ready for your review",
    live: "Your site is live",
  });

/** The launch date as staff read it: "2026-10-11 14:02 America/Chicago". */
export function launchedLine(stored: string, zone = "America/Chicago"): string {
  const d = new Date(stored.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return stored;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ${zone}`;
}

/** The refusal for a backward move (UI-SPEC wording for live). */
export function backwardRefusal(from: OrgStage, to: OrgStage): string {
  if (from === "live") {
    return "Refused: live is final. Use the launch tools in P14 to undo a launch.";
  }
  return `Refused: ${from} -> ${to} goes backwards. A stage only moves forward.`;
}

/**
 * Review 11 WR-A01: a stage move is never a way around the fit gate. A site in fit_review
 * is cleared with fit:review only; a held or closed site never moves (setOrgStage refuses
 * too). Null when the move may go ahead.
 */
export function gateRefusal(from: OrgStage, status: string): string | null {
  if (from === "fit_review") {
    return "Refused: this site is in fit review. Use fit:review to clear or decline it.";
  }
  if (status === "held") {
    return "Refused: this site is held. Its stage can't move until fit:review clears it.";
  }
  if (status === "disabled") {
    return "Refused: this site is closed or disabled. Its stage can't move.";
  }
  return null;
}

/** 14-36 (Pitfall 12): the refusal for `--to live` on a site with a domain move. */
export const LIVE_VIA_APPROVE =
  "Refused: this site has a domain move. Use Approve launch in the console.";

/**
 * 14-36: `--to live` is refused while the org has a non-cancelled launch move: the move's
 * cutover is the only way such a site goes live (it switches the domain first). Sites with no
 * domain move can still be moved by this CLI (dev and demo). Null when the move may go ahead.
 */
export async function liveRefusal(
  ctx: PlatformContext,
  orgId: string,
  to: OrgStage | null,
): Promise<string | null> {
  if (to !== "live") return null;
  return (await staffHasLaunchMove(ctx, orgId)) ? LIVE_VIA_APPROVE : null;
}

function notFound(org: string): CliFail {
  return new CliFail(
    `Org ${org} not found, or this account can't change its stage or note.`,
    { plain: true },
  );
}

const quoted = (note: string) => (note ? `"${safeText(note)}"` : "(none)");

export async function main(
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const args = parseArgs(argv, {
    known: [
      "--org",
      "--to",
      "--build-note",
      "--clear-note",
      "--dry-run",
      "--yes",
    ],
    withValue: ["--org", "--to", "--build-note"],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }
  const org = args.get("--org");
  if (typeof org !== "string") fail("--org <org-id> is required");
  if (!ORG_RE.test(org)) fail("--org is not a valid organization id");

  const rawTo = args.get("--to");
  let to: Exclude<OrgStage, ""> | null = null;
  if (rawTo !== undefined) {
    if (!isOrgStage(rawTo)) {
      fail(`--to must be one of ${ORG_STAGES.join(", ")}`);
    }
    to = rawTo;
  }
  const rawNote = args.get("--build-note");
  const clearNote = args.has("--clear-note");
  if (rawNote !== undefined && clearNote) {
    fail("--build-note and --clear-note can't be combined");
  }
  let note: string | null = null;
  if (typeof rawNote === "string") {
    note = rawNote.trim();
    if (note === "" || note.length > BUILD_NOTE_MAX) {
      fail(`--build-note must be 1-${BUILD_NOTE_MAX} characters`);
    }
    if (/[\r\n]/.test(note)) fail("--build-note must be one line");
  } else if (clearNote) {
    note = "";
  }

  const ctx = await signInStaffInteractive();
  // T-11-42-01: a support agent never moves a stage (setOrgStage refuses too).
  if (to && ctx.staffRole !== "super_admin") {
    throw new CliFail(
      "Refused: moving a stage needs super_admin. Support agents can set the build note only.",
      { plain: true },
    );
  }

  try {
    const cur = await staffOrgStage(ctx, org);
    const name = safeText(cur.orgName || org);
    const from = cur.stage;
    const moving = to !== null && to !== from;
    if (to && moving && from !== "") {
      if (ORG_STAGES.indexOf(to) < ORG_STAGES.indexOf(from)) {
        console.log(`${name} · ${from} -> ${to}`);
        throw new CliFail(backwardRefusal(from, to), { plain: true });
      }
    }
    if (to && moving) {
      const refusal =
        gateRefusal(from, cur.status ?? "") ??
        (await liveRefusal(ctx, org, to));
      if (refusal) {
        console.log(`${name} · ${from || "(no stage)"} -> ${to}`);
        throw new CliFail(refusal, { plain: true });
      }
    }
    const noteChanges = note !== null && note !== cur.buildNote;

    console.log(
      moving
        ? `${name} · ${from || "(no stage)"} -> ${to}`
        : `${name} · ${from || "(no stage)"}`,
    );
    console.log(
      noteChanges
        ? `Build note: ${quoted(cur.buildNote)} -> ${quoted(note ?? "")}`
        : `Build note: ${quoted(cur.buildNote)}`,
    );
    if (cur.launchedAt) {
      console.log(`Launched:   ${launchedLine(cur.launchedAt)}`);
    }
    if (to && !moving) console.log(`Already ${to}.`);

    if (!moving && !noteChanges) {
      if (to || note !== null) console.log("Nothing changed.");
      return;
    }
    if (args.has("--dry-run")) {
      const what = [
        moving ? `move to ${to}` : "",
        noteChanges
          ? note
            ? "set the build note"
            : "clear the build note"
          : "",
      ]
        .filter(Boolean)
        .join(" and ");
      console.log(`DRY RUN would ${what}; nothing changed`);
      return;
    }
    if (moving && !args.has("--yes")) {
      const answer = await ask("Set? [y/N] ");
      if (!/^y(es)?$/i.test(answer)) {
        console.log("Nothing changed.");
        return;
      }
    }

    if (moving && to) {
      const r = await setOrgStage(ctx, org, to);
      // Review 11 WR-A03: the stage has committed (audited, team alerted). Say so now, so
      // a failed note write below can never read as "nothing happened".
      if (to === "live" && r.launchedAt && !cur.launchedAt) {
        console.log(`launched_at: ${launchedLine(r.launchedAt)}`);
      }
      console.log(`Stage moved: ${from || "(no stage)"} -> ${to}.`);
      if (noteChanges) {
        try {
          await setBuildNote(ctx, org, note ?? "");
        } catch (err) {
          const why =
            err instanceof InvalidInput
              ? safeText(err.message)
              : err instanceof NotFound || err instanceof Forbidden
                ? "not found, or this account can't change the note"
                : err instanceof Error
                  ? err.name
                  : "unknown error";
          throw new CliFail(
            `Stage moved to ${to}; the build note was NOT saved: ${why}. Rerun with --build-note (or --clear-note) only.`,
            { plain: true },
          );
        }
      }
      console.log(`Done. The owner sees "${OWNER_SEES[to]}" on Today.`);
      return;
    }
    await setBuildNote(ctx, org, note ?? "");
    console.log(
      note
        ? "Done. The owner sees the new note under What CDS is doing now on Today."
        : "Done. Today shows the default line again.",
    );
  } catch (err) {
    if (err instanceof CliFail) throw err;
    if (err instanceof NotFound || err instanceof Forbidden) {
      throw notFound(org);
    }
    if (err instanceof InvalidInput) {
      throw new CliFail(`Refused: ${err.message}`, { plain: true });
    }
    throw err;
  }
}

// Exported for tests; runs only when executed directly (node … org-stage.ts).
const entry = process.argv[1];
if (
  entry &&
  resolve(entry).toLowerCase() ===
    resolve(fileURLToPath(import.meta.url)).toLowerCase()
) {
  runMain(() => main());
}

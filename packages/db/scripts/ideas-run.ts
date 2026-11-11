// Ideas board curation from the terminal (12-30; CUSTOM-01; UI-SPEC "Staff CLI output"). `list`
// ideas (with the suggesting business, staff only), set a `status` (linked suggestion tickets
// move to Resolved; Built alerts every voting site), `merge` a duplicate (votes move, one per
// site), `hide` / `unhide` and `edit`, through the 12-22 staff functions (`ideas_run`:
// super_admin or support_agent) after a CDS staff sign-in with the emailed code. Every change is
// audited with the staff actor. status and merge ask "[y/N]" (--yes skips).
//
// Usage:
//   npm run ideas:run -- list [--hidden] [--merged] [--status <status>] [--dry-run]
//   npm run ideas:run -- status --idea <id> --to considering|planned|built|suggested [--yes] [--dry-run]
//   npm run ideas:run -- merge --idea <id> --into <id> [--yes] [--dry-run]
//   npm run ideas:run -- hide --idea <id> [--dry-run] | unhide --idea <id> [--dry-run]
//   npm run ideas:run -- edit --idea <id> [--title "<text>"] [--description "<text>"] [--dry-run]
//   npm run ideas:run -- --help
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by
// the npm script). Credentials and codes are never printed.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import type { PlatformContext } from "../src/context";
import type { EmailTransport } from "../src/email/transport";
import {
  IDEA_DESCRIPTION_MAX,
  IDEA_HOLD_REVIEW,
  IDEA_STATUSES,
  IDEA_TITLE_MAX,
  staffEditIdea,
  staffHideIdea,
  staffListIdeas,
  staffMergeIdeas,
  staffSetIdeaStatus,
  staffUnhideIdea,
  type IdeaStatus,
  type StaffIdeaRow,
} from "../src/support/ideas";
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

const STATUS_HELP = IDEA_STATUSES.join(", ");

export const USAGE = `ideas:run - curate the Suggest a feature board (super_admin or support_agent)

  npm run ideas:run -- list [--hidden] [--merged] [--status <status>] [--dry-run]
  npm run ideas:run -- status --idea <id> --to <status> [--yes] [--dry-run]
  npm run ideas:run -- merge --idea <id> --into <id> [--yes] [--dry-run]
  npm run ideas:run -- hide --idea <id> [--dry-run]
  npm run ideas:run -- unhide --idea <id> [--dry-run]
  npm run ideas:run -- edit --idea <id> [--title "<text>"] [--description "<text>"] [--dry-run]
  npm run ideas:run -- --help

list      ideas by votes, with the suggesting business and ticket (CDS only). Hidden
          ideas (held for review or hidden by staff) only with --hidden; ideas merged
          into another only with --merged; --status ${STATUS_HELP}
status    --to ${STATUS_HELP}. A change resolves the linked suggestion tickets with an
          "Idea status" line; Built alerts every site that voted. Asks "Set? [y/N]".
merge     move a duplicate's votes into another idea (a site that voted for both keeps
          one vote); the duplicate leaves the board. Asks "Merge? [y/N]".
hide      take an idea off the board (it keeps its votes); unhide puts it back and
          clears a review hold
edit      fix the title (up to ${IDEA_TITLE_MAX}) or description (up to ${IDEA_DESCRIPTION_MAX.toLocaleString("en-US")}), e.g. to remove a
          business name; no rescan
--yes     skip the y/N confirm
--dry-run list: check the arguments only; others: sign in and print what would change
Prompts for staff email, password and the emailed sign-in code.
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)`;

export type IdeasCliDeps = {
  now?: () => Date;
  transport?: EmailTransport;
};

function refusal(err: unknown): never {
  if (err instanceof NotFound || err instanceof Forbidden) {
    throw new CliFail("Idea not found, or this account can't curate ideas.", {
      plain: true,
    });
  }
  if (err instanceof InvalidInput) {
    throw new CliFail(`Refused: ${err.message}`, { plain: true });
  }
  throw err;
}

function ideaArg(args: ParsedArgs, flag = "--idea"): string {
  const v = args.get(flag);
  if (typeof v !== "string") fail(`${flag} <idea-id> is required`);
  if (!ORG_RE.test(v)) fail(`${flag} is not a valid idea id`);
  return v;
}

function statusArg(raw: string): IdeaStatus {
  const s = raw.trim().toLowerCase();
  if (!(IDEA_STATUSES as readonly string[]).includes(s)) {
    fail(`--to must be ${STATUS_HELP}`);
  }
  return s as IdeaStatus;
}

function label(s: IdeaStatus): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Every idea (hidden and merged included), for titles and checks. */
async function allIdeas(ctx: PlatformContext): Promise<StaffIdeaRow[]> {
  try {
    return await staffListIdeas(ctx, {
      includeHidden: true,
      includeMerged: true,
    });
  } catch (err) {
    refusal(err);
  }
}

async function findIdea(
  ctx: PlatformContext,
  id: string,
): Promise<StaffIdeaRow> {
  const hit = (await allIdeas(ctx)).find((r) => r.id === id);
  if (!hit) {
    throw new CliFail("Idea not found, or this account can't curate ideas.", {
      plain: true,
    });
  }
  return hit;
}

async function confirm(args: ParsedArgs, prompt: string): Promise<boolean> {
  if (args.has("--yes")) return true;
  const answer = await ask(prompt);
  if (/^y(es)?$/i.test(answer)) return true;
  console.log("Nothing changed.");
  return false;
}

function state(r: StaffIdeaRow): string {
  if (r.mergedInto) return "merged";
  if (r.hiddenAt)
    return r.holdReason === IDEA_HOLD_REVIEW ? "held for review" : "hidden";
  return "shown";
}

async function list(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv, {
    known: ["--hidden", "--merged", "--status", "--dry-run"],
    withValue: ["--status"],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }
  const rawStatus = args.get("--status");
  let status: IdeaStatus | undefined;
  if (typeof rawStatus === "string") {
    const s = rawStatus.trim().toLowerCase();
    if (!(IDEA_STATUSES as readonly string[]).includes(s)) {
      fail(`--status must be ${STATUS_HELP}`);
    }
    status = s as IdeaStatus;
  }
  if (args.has("--dry-run")) {
    console.log("DRY RUN arguments are fine; nothing read");
    return;
  }
  const ctx = await signInStaffInteractive();
  let rows: StaffIdeaRow[];
  try {
    rows = await staffListIdeas(ctx, {
      ...(status ? { status } : {}),
      includeHidden: true,
      includeMerged: args.has("--merged"),
    });
  } catch (err) {
    refusal(err);
  }
  const hidden = rows.filter((r) => r.hiddenAt && !r.mergedInto);
  const held = hidden.filter((r) => r.holdReason === IDEA_HOLD_REVIEW);
  const shown = args.has("--hidden") ? rows : rows.filter((r) => !r.hiddenAt);
  if (shown.length === 0) console.log("No ideas.");
  else {
    console.log(
      table(
        ["Idea", "Votes", "Status", "State", "Suggested by", "Ticket", "Title"],
        shown.map((r) => [
          r.id,
          String(r.votes),
          label(r.status),
          state(r),
          r.sourceOrgName || r.sourceOrg || "—",
          r.sourceTicket ? `#${r.sourceTicket}` : "—",
          r.title,
        ]),
      ),
    );
  }
  const tail = [plural(shown.length, "idea")];
  if (!args.has("--hidden") && hidden.length > 0) {
    tail.push(
      `${hidden.length} hidden (${held.length} held for review; add --hidden)`,
    );
  }
  console.log(tail.join(" · "));
}

async function setStatus(
  argv: readonly string[],
  deps: IdeasCliDeps,
): Promise<void> {
  const args = parseArgs(argv, {
    known: ["--idea", "--to", "--yes", "--dry-run"],
    withValue: ["--idea", "--to"],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }
  const id = ideaArg(args);
  const raw = args.get("--to");
  if (typeof raw !== "string")
    fail(`--to <status> is required (${STATUS_HELP})`);
  const to = statusArg(raw);
  const ctx = await signInStaffInteractive();
  const idea = await findIdea(ctx, id);
  if (idea.mergedInto) {
    throw new CliFail(
      `Refused: "${safeText(idea.title)}" was merged into another idea; set the status there.`,
      { plain: true },
    );
  }
  if (idea.status === to) {
    console.log(
      `"${safeText(idea.title)}" is already ${label(to)}; nothing changed.`,
    );
    return;
  }
  console.log(
    `"${safeText(idea.title)}": ${label(idea.status)} → ${label(to)} · ${plural(idea.votes, "vote")}`,
  );
  console.log(
    to === "built"
      ? "  Linked suggestion tickets move to Resolved; every site that voted is alerted."
      : "  Linked suggestion tickets move to Resolved with an Idea status line.",
  );
  if (args.has("--dry-run")) {
    console.log("DRY RUN would set this status; nothing changed");
    return;
  }
  if (!(await confirm(args, "Set? [y/N] "))) return;
  const now = (deps.now ?? (() => new Date()))();
  try {
    const r = await staffSetIdeaStatus(
      ctx,
      { id, to },
      { clock: { now: () => now }, transport: deps.transport },
    );
    const parts = [
      `"${safeText(idea.title)}" is now ${label(r.to)}`,
      `${plural(r.resolved, "suggestion ticket")} resolved`,
    ];
    if (r.to === "built")
      parts.push(`${plural(r.notified, "voting site")} alerted`);
    console.log(`${parts.join(" · ")}.`);
  } catch (err) {
    refusal(err);
  }
}

async function merge(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv, {
    known: ["--idea", "--into", "--yes", "--dry-run"],
    withValue: ["--idea", "--into"],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }
  const fromId = ideaArg(args);
  const intoId = ideaArg(args, "--into");
  if (fromId === intoId) fail("--idea and --into must be different ideas");
  const ctx = await signInStaffInteractive();
  const ideas = await allIdeas(ctx);
  const from = ideas.find((r) => r.id === fromId);
  const into = ideas.find((r) => r.id === intoId);
  if (!from || !into) {
    throw new CliFail("Idea not found, or this account can't curate ideas.", {
      plain: true,
    });
  }
  console.log(
    `Merge "${safeText(from.title)}" (${plural(from.votes, "vote")}) into "${safeText(into.title)}" (${plural(into.votes, "vote")}).`,
  );
  console.log(
    "  The duplicate leaves the board; a site that voted for both keeps one vote.",
  );
  if (args.has("--dry-run")) {
    console.log("DRY RUN would merge these ideas; nothing changed");
    return;
  }
  if (!(await confirm(args, "Merge? [y/N] "))) return;
  try {
    const r = await staffMergeIdeas(ctx, { from: fromId, into: intoId });
    console.log(
      `Merged "${safeText(from.title)}" into "${safeText(into.title)}" · votes ${r.fromVotes} + ${r.intoVotes} → ${r.total} (${plural(r.both, "site")} voted for both).`,
    );
  } catch (err) {
    refusal(err);
  }
}

async function hideOrUnhide(
  argv: readonly string[],
  hide: boolean,
): Promise<void> {
  const args = parseArgs(argv, {
    known: ["--idea", "--dry-run"],
    withValue: ["--idea"],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }
  const id = ideaArg(args);
  const ctx = await signInStaffInteractive();
  const idea = await findIdea(ctx, id);
  const title = safeText(idea.title);
  if (args.has("--dry-run")) {
    console.log(
      `DRY RUN would ${hide ? "hide" : "unhide"} "${title}" (now ${state(idea)}); nothing changed`,
    );
    return;
  }
  try {
    if (hide) {
      const r = await staffHideIdea(ctx, { id });
      console.log(
        r.hidden
          ? `Hidden "${title}". It is off the board and keeps its votes.`
          : `"${title}" was already hidden; nothing changed.`,
      );
    } else {
      const r = await staffUnhideIdea(ctx, { id });
      console.log(
        r.shown
          ? `Shown "${title}". It is back on the board.`
          : `"${title}" was already on the board; nothing changed.`,
      );
    }
  } catch (err) {
    refusal(err);
  }
}

async function edit(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv, {
    known: ["--idea", "--title", "--description", "--dry-run"],
    withValue: ["--idea", "--title", "--description"],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }
  const id = ideaArg(args);
  const input: { id: string; title?: string; description?: string } = { id };
  const title = args.get("--title");
  if (typeof title === "string") {
    const t = title.replace(/\s+/g, " ").trim();
    if (t === "" || t.length > IDEA_TITLE_MAX) {
      fail(`--title must be 1-${IDEA_TITLE_MAX} characters`);
    }
    input.title = t;
  }
  const description = args.get("--description");
  if (typeof description === "string") {
    const d = description.trim();
    if (d === "" || d.length > IDEA_DESCRIPTION_MAX) {
      fail(
        `--description must be 1-${IDEA_DESCRIPTION_MAX.toLocaleString("en-US")} characters`,
      );
    }
    input.description = d;
  }
  if (input.title === undefined && input.description === undefined) {
    fail('give --title "<text>" or --description "<text>"');
  }
  const ctx = await signInStaffInteractive();
  const idea = await findIdea(ctx, id);
  if (input.title !== undefined) {
    console.log(
      `Title: "${safeText(idea.title)}" → "${safeText(input.title)}"`,
    );
  }
  if (input.description !== undefined) {
    console.log(`Description: ${safeText(input.description)}`);
  }
  if (args.has("--dry-run")) {
    console.log("DRY RUN would save this edit; nothing changed");
    return;
  }
  try {
    const r = await staffEditIdea(ctx, input);
    console.log(
      r.changed.length > 0
        ? `Saved: ${r.changed.join(" and ")} changed.`
        : "Nothing to change; the idea already reads that way.",
    );
  } catch (err) {
    refusal(err);
  }
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  deps: IdeasCliDeps = {},
): Promise<void> {
  const verb = argv[0];
  if (verb === undefined || verb === "--help" || verb === "-h") {
    console.log(USAGE);
    if (verb === undefined) {
      fail("give a verb: list, status, merge, hide, unhide or edit");
    }
    return;
  }
  const rest = argv.slice(1);
  switch (verb) {
    case "list":
      return list(rest);
    case "status":
      return setStatus(rest, deps);
    case "merge":
      return merge(rest);
    case "hide":
      return hideOrUnhide(rest, true);
    case "unhide":
      return hideOrUnhide(rest, false);
    case "edit":
      return edit(rest);
    default:
      console.log(USAGE);
      fail(
        `unknown verb ${verb.slice(0, 40)}: use list, status, merge, hide, unhide or edit`,
      );
  }
}

// Exported for tests; runs only when executed directly (node … ideas-run.ts).
const entry = process.argv[1];
if (
  entry &&
  resolve(entry).toLowerCase() ===
    resolve(fileURLToPath(import.meta.url)).toLowerCase()
) {
  runMain(() => main());
}

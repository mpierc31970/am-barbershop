// Save-time scan for the core public lists: team members and services (13-52; STAFF-25,
// D248, D270; 13-VERIFICATION gap). Internal, never exported from index.ts.
//
// Same contract as the add-on record path (addons/records.ts prepareRecord + afterRecordSave):
//   - screen() runs over the row's public text before it is written; "held" saves the row
//     hidden (is_published false) and opens a flag, "unsure" saves as asked and opens a flag,
//     a scanner outage saves as asked and queues a flag for the hourly rescan (source scan)
//   - switching a row off adds nothing public, so it is not screened
//   - afterLiveSave records the flag, rebuilds the site index, drops the live tag, pings once
// The writers screen inside the org lock (as rescreenFit does for the profile), so the text
// that was scanned is exactly the text that is written.
import type { OrgContext } from "../context";
import type { ContentScanner, Invalidator } from "../content/ports";
import { recordContentFlag } from "../content/flags";
import {
  afterLiveSave,
  screen,
  type LiveSaveDeps,
  type ScanOutcome,
} from "../content/screen";

export type ListCollection = "team_members" | "services";

/** Optional seams; apps/web passes contentDeps(). Seeds and tests may pass nothing. */
export type ListScanDeps = Partial<LiveSaveDeps> & {
  scanner?: ContentScanner;
};

const NO_INVALIDATE: Invalidator = { invalidate() {} };

const CLEAN: ScanOutcome = { verdict: "clean", reasons: [] };

const nonEmpty = (v: unknown): string[] =>
  typeof v === "string" && v.trim() !== "" ? [v] : [];

/** The public text of a validated row (registry `public`: name, role, bio / description). */
export function listTexts(
  collection: ListCollection,
  row: Record<string, unknown>,
): string[] {
  return collection === "team_members"
    ? [...nonEmpty(row.name), ...nonEmpty(row.role), ...nonEmpty(row.bio)]
    : [...nonEmpty(row.name), ...nonEmpty(row.description)];
}

/**
 * Screen one validated row. Returns the outcome and the body to write: held forces
 * is_published false. `toggleOff` (only is_published false was sent) skips the scan.
 */
export async function screenListRow(
  ctx: OrgContext,
  deps: ListScanDeps,
  collection: ListCollection,
  body: Record<string, unknown>,
  opts: { toggleOff?: boolean } = {},
): Promise<{
  body: Record<string, unknown>;
  outcome: ScanOutcome;
  held: boolean;
}> {
  if (opts.toggleOff) return { body, outcome: CLEAN, held: false };
  const outcome = await screen(ctx, deps, listTexts(collection, body), []);
  const held = outcome.verdict === "held";
  return {
    body: held ? { ...body, is_published: false } : body,
    outcome,
    held,
  };
}

/** True when the input only switches the row off (nothing new goes public). */
export function isToggleOff(raw: Record<string, unknown>): boolean {
  const keys = Object.keys(raw);
  return (
    keys.length === 1 &&
    keys[0] === "is_published" &&
    raw.is_published === false
  );
}

function liveDeps(deps: ListScanDeps): LiveSaveDeps {
  return { ...deps, invalidator: deps.invalidator ?? NO_INVALIDATE };
}

/** After one record's write: flag (if not clean), site index, live tag, ping. */
export async function afterListSave(
  ctx: OrgContext,
  deps: ListScanDeps,
  outcome: ScanOutcome,
  target: { collection: string; id: string },
): Promise<void> {
  await afterLiveSave(ctx, liveDeps(deps), outcome, target);
}

/**
 * After an import: one flag per non-clean row, then one site-index rebuild, invalidation
 * and ping (afterLiveSave with a clean outcome, so nothing is flagged twice).
 */
export async function afterListImport(
  ctx: OrgContext,
  deps: ListScanDeps,
  collection: ListCollection,
  rows: readonly { id: string; outcome: ScanOutcome }[],
): Promise<void> {
  for (const { id, outcome } of rows) {
    if (outcome.verdict === "clean") continue;
    await recordContentFlag(ctx, {
      targetCollection: collection,
      targetId: id,
      verdict: outcome.verdict,
      reasons: outcome.reasons,
      status: outcome.verdict === "error" ? "queued" : "open",
      ...(outcome.verdict === "error" ? { source: "scan" as const } : {}),
    });
  }
  await afterLiveSave(ctx, liveDeps(deps), CLEAN, {
    collection,
    id: rows[0]?.id ?? "",
  });
}

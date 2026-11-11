// Intake working state chokepoint (ONB-01, ONB-02; CONTEXT A3-Q1, A3-Q2; invariant 1, TEN-03,
// PD-21; T-06-52, T-06-54, T-06-56).
//
// One org_intake row per organization (unique index; signup creates it with the quote's
// selections). It holds only what the intake needs: domain / integration answers, which
// stages were saved (so progress resumes across sittings, ONB-02), the first-visit flag, the
// submit time, per-add-on config and the moodboard proposal. Business facts live in their
// permanent records (business_profile, team_members, services). Reads: business read (Editor
// ok); writes: business write (Owner / Admin). Nothing here takes an org id.
import { InvalidInput } from "@cds/core";
import {
  isStageSlug,
  STAGES,
  validateAnswersPatch,
  type IntakeAnswers,
  type StageSlug,
} from "@cds/core/intake";
import { normaliseSelections, type QuoteSelections } from "@cds/core/pricing";
import type { MoodboardProposal } from "@cds/core/theme";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import type { OrgContext } from "../context";
import { newRecordId } from "../repository";
import {
  asInput,
  commit,
  orgRow,
  rejectForeignOrg,
  runRead,
  runWrite,
} from "./shared";

const COLLECTION = "org_intake";

export type AddonIntakeConfig = Record<
  string,
  {
    fields: Record<string, unknown>;
    records: Record<string, unknown>[];
    /**
     * B-WR-08: one stable key per held record, parallel to `records` (same order). Edit and
     * remove address a row by key, never by position. Kept beside the records so the rows
     * themselves stay exactly what the add-on's validator produced (P8 installs them as-is).
     * Always filled when read; rows stored before keys existed get `r<index>`.
     */
    keys?: string[];
  }
>;

const INTAKE_KEY_RE = /^[A-Za-z0-9_-]{1,32}$/;

/** True for a well-shaped held-record key. */
export function isIntakeKey(v: unknown): v is string {
  return typeof v === "string" && INTAKE_KEY_RE.test(v);
}

export type OrgIntake = {
  selections: QuoteSelections;
  answers: IntakeAnswers;
  stagesSaved: StageSlug[];
  firstVisitDismissed: boolean;
  submittedAt: Date | null;
  addonConfig: AddonIntakeConfig;
  moodboardProposal: MoodboardProposal | null;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function emptyAnswers(): IntakeAnswers {
  return {
    domain_choice: "later",
    domain: "",
    registrar: "",
    domain_ideas: "",
    gbp: "",
  };
}

/** Stored answers, re-validated key by key; a malformed key falls back to its default. */
function answersOf(raw: unknown): IntakeAnswers {
  const out = emptyAnswers();
  if (!isRecord(raw)) return out;
  for (const key of Object.keys(out) as (keyof IntakeAnswers)[]) {
    if (!Object.hasOwn(raw, key)) continue;
    try {
      Object.assign(out, validateAnswersPatch({ [key]: raw[key] }));
    } catch {
      // keep the default
    }
  }
  return out;
}

function selectionsOf(raw: unknown): QuoteSelections {
  try {
    return normaliseSelections(isRecord(raw) ? raw : {});
  } catch {
    return normaliseSelections({});
  }
}

function stagesOf(raw: unknown): StageSlug[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set(raw.filter(isStageSlug));
  // Stage order, not save order.
  return STAGES.map((s) => s.slug).filter((s) => seen.has(s));
}

function dateOf(raw: unknown): Date | null {
  if (typeof raw !== "string" || raw === "") return null;
  const d = new Date(raw.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

function addonConfigOf(raw: unknown): AddonIntakeConfig {
  if (!isRecord(raw)) return {};
  const out: AddonIntakeConfig = {};
  for (const [slug, v] of Object.entries(raw)) {
    if (!isRecord(v)) continue;
    const raw = Array.isArray(v.records) ? v.records : [];
    const stored =
      Array.isArray(v.keys) &&
      v.keys.length === raw.length &&
      v.keys.every(isIntakeKey) &&
      new Set(v.keys).size === v.keys.length
        ? (v.keys as string[])
        : null;
    const records: Record<string, unknown>[] = [];
    const keys: string[] = [];
    raw.forEach((r, i) => {
      if (!isRecord(r)) return;
      records.push(r);
      keys.push(stored ? stored[i]! : `r${i}`);
    });
    out[slug] = {
      fields: isRecord(v.fields) ? v.fields : {},
      records,
      keys,
    };
  }
  return out;
}

function fromRow(row: RecordModel | null): OrgIntake {
  return {
    selections: selectionsOf(row?.selections),
    answers: answersOf(row?.answers),
    stagesSaved: stagesOf(row?.stages_saved),
    firstVisitDismissed: dateOf(row?.first_visit_dismissed_at) !== null,
    submittedAt: dateOf(row?.submitted_at),
    addonConfig: addonConfigOf(row?.addon_config),
    moodboardProposal: isRecord(row?.moodboard_proposal)
      ? (row.moodboard_proposal as MoodboardProposal)
      : null,
  };
}

/** Update the org's row, or create it (signup normally has) with the given body. */
async function upsert(
  pb: PocketBase,
  ctx: OrgContext,
  current: RecordModel | null,
  body: Record<string, unknown>,
  action: string,
): Promise<void> {
  if (current) {
    await commit(
      pb,
      ctx,
      [{ collection: COLLECTION, op: "update", id: current.id, body }],
      {
        action: `${COLLECTION}.${action}`,
        targetCollection: COLLECTION,
        targetId: current.id,
      },
    );
    return;
  }
  const id = newRecordId();
  await commit(
    pb,
    ctx,
    [
      {
        collection: COLLECTION,
        op: "create",
        id,
        body: { selections: {}, ...body, organization: ctx.orgId },
      },
    ],
    {
      action: `${COLLECTION}.${action}`,
      targetCollection: COLLECTION,
      targetId: id,
    },
  );
}

/** The org's intake state; defaults (never written) when the row is missing. */
export async function getOrgIntake(ctx: OrgContext): Promise<OrgIntake> {
  return runRead(ctx, async (pb) => fromRow(await orgRow(pb, ctx, COLLECTION)));
}

/** Record a stage as saved. Idempotent: saving it again keeps one entry. */
export async function markStageSaved(
  ctx: OrgContext,
  stage: StageSlug,
): Promise<void> {
  if (!isStageSlug(stage)) {
    throw new InvalidInput("That step doesn't exist. Refresh and try again.");
  }
  await runWrite(ctx, async (pb) => {
    const current = await orgRow(pb, ctx, COLLECTION);
    const saved = stagesOf(current?.stages_saved);
    if (saved.includes(stage)) return;
    await upsert(
      pb,
      ctx,
      current,
      { stages_saved: stagesOf([...saved, stage]) },
      "stage",
    );
  });
}

/** Save domain / integration answers (allow-listed keys only); returns the stored answers. */
export async function saveIntakeAnswers(
  ctx: OrgContext,
  patch: unknown,
): Promise<IntakeAnswers> {
  const input = asInput(patch, "The change");
  rejectForeignOrg(ctx, input);
  const values = validateAnswersPatch(input);
  return runWrite(ctx, async (pb) => {
    const current = await orgRow(pb, ctx, COLLECTION);
    const answers: IntakeAnswers = {
      ...answersOf(current?.answers),
      ...values,
    };
    if (Object.keys(values).length > 0) {
      await upsert(pb, ctx, current, { answers }, "answers");
    }
    return answers;
  });
}

/** Hide the first-visit welcome for good (one timestamp; a second call keeps the first). */
export async function dismissFirstVisit(ctx: OrgContext): Promise<void> {
  await runWrite(ctx, async (pb) => {
    const current = await orgRow(pb, ctx, COLLECTION);
    if (dateOf(current?.first_visit_dismissed_at)) return;
    await upsert(
      pb,
      ctx,
      current,
      { first_visit_dismissed_at: new Date().toISOString() },
      "first_visit",
    );
  });
}

/** The stored row as OrgIntake (snapshot / assembly / send read it in their own client). */
export const intakeFromRow = fromRow;

"use server";
// Ideas actions (13-36 choice 3; P12 `ideas:run` in the console; D-UI Ideas lines 587-596).
// Public POST endpoints: every argument is untrusted. Thin callers of the functions the CLI
// calls (`ideas_run`, both staff roles, no step-up), with the CLI's checks and result lines:
//   status -> staffSetIdeaStatus  ""Gift cards" is now Built · 2 suggestion tickets resolved ·
//                                  7 voting sites alerted."
//   merge  -> staffMergeIdeas     "Merged "X" into "Y" · votes 7 + 5 → 10 (2 sites voted for both)."
//   hide / unhide -> staffHideIdea / staffUnhideIdea
//   edit   -> staffEditIdea       "Saved: title and description changed."
// Errors are logged by class name only.
import { NotFound } from "@cds/core";
import {
  IDEA_DESCRIPTION_MAX,
  IDEA_STATUSES,
  IDEA_TITLE_MAX,
  staffEditIdea,
  staffHideIdea,
  staffListIdeas,
  staffMergeIdeas,
  staffSetIdeaStatus,
  staffUnhideIdea,
  type IdeaStatus,
  type PlatformContext,
  type StaffIdeaRow,
} from "@cds/db";
import { revalidatePath } from "next/cache";
import {
  errorName,
  runStaffAction,
  type ActionResult,
} from "../../../lib/staff-action";

type Failure = Extract<ActionResult<never>, { ok: false }>;

const ID_RE = /^[a-z0-9]{15}$/;
const IDEA_NOT_FOUND: Failure = {
  ok: false,
  code: "not_found",
  message: "That idea wasn't found.",
};

function bad(message: string, field?: string): Failure {
  return {
    ok: false,
    code: "invalid_input",
    message,
    ...(field ? { field } : {}),
  };
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function label(s: IdeaStatus): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function refresh(): void {
  try {
    revalidatePath("/staff", "layout");
  } catch (err) {
    console.error("[staff ideas] revalidate failed", errorName(err));
  }
}

/** Every idea (hidden and merged included), as the CLI's findIdea reads them. */
async function findIdea(
  ctx: PlatformContext,
  id: string,
): Promise<StaffIdeaRow> {
  const hit = (
    await staffListIdeas(ctx, { includeHidden: true, includeMerged: true })
  ).find((r) => r.id === id);
  if (!hit) throw new NotFound("idea not found");
  return hit;
}

/** Set an idea's status. Built alerts every site that voted (the dialog says so first). */
export async function ideaStatusAction(
  idRaw: unknown,
  toRaw: unknown,
): Promise<ActionResult<{ message: string; changed: boolean }>> {
  if (typeof idRaw !== "string" || !ID_RE.test(idRaw)) return IDEA_NOT_FOUND;
  if (
    typeof toRaw !== "string" ||
    !(IDEA_STATUSES as readonly string[]).includes(toRaw)
  ) {
    return bad("Choose a status.", "status");
  }
  const to = toRaw as IdeaStatus;
  const result = await runStaffAction(
    "ideas_run",
    {},
    async (
      ctx,
    ): Promise<{ message: string; changed: boolean; refused: boolean }> => {
      const idea = await findIdea(ctx, idRaw);
      if (idea.mergedInto) {
        return {
          message: `"${idea.title}" was merged into another idea; set the status there.`,
          changed: false,
          refused: true,
        };
      }
      if (idea.status === to) {
        return {
          message: `"${idea.title}" is already ${label(to)}; nothing changed.`,
          changed: false,
          refused: false,
        };
      }
      const r = await staffSetIdeaStatus(ctx, { id: idRaw, to });
      const parts = [
        `"${idea.title}" is now ${label(r.to)}`,
        `${plural(r.resolved, "suggestion ticket")} resolved`,
      ];
      if (r.to === "built") {
        parts.push(`${plural(r.notified, "voting site")} alerted`);
      }
      return {
        message: `${parts.join(" · ")}.`,
        changed: true,
        refused: false,
      };
    },
  );
  if (!result.ok) return result;
  if (result.data.refused) return bad(result.data.message, "status");
  if (result.data.changed) refresh();
  return {
    ok: true,
    data: { message: result.data.message, changed: result.data.changed },
  };
}

/** Merge a duplicate into another idea; votes move, a site that voted for both keeps one. */
export async function mergeIdeasAction(
  fromRaw: unknown,
  intoRaw: unknown,
): Promise<ActionResult<{ message: string; total: number }>> {
  if (typeof fromRaw !== "string" || !ID_RE.test(fromRaw))
    return IDEA_NOT_FOUND;
  if (typeof intoRaw !== "string" || !ID_RE.test(intoRaw))
    return IDEA_NOT_FOUND;
  if (fromRaw === intoRaw) {
    return bad("Choose a different idea to merge into.", "into");
  }
  const result = await runStaffAction("ideas_run", {}, async (ctx) => {
    const from = await findIdea(ctx, fromRaw);
    const into = await findIdea(ctx, intoRaw);
    const r = await staffMergeIdeas(ctx, { from: fromRaw, into: intoRaw });
    return {
      message: `Merged "${from.title}" into "${into.title}" · votes ${r.fromVotes} + ${r.intoVotes} → ${r.total} (${plural(r.both, "site")} voted for both).`,
      total: r.total,
    };
  });
  if (result.ok) refresh();
  return result;
}

/** Take an idea off the board (it keeps its votes). */
export async function hideIdeaAction(
  idRaw: unknown,
): Promise<ActionResult<{ message: string }>> {
  if (typeof idRaw !== "string" || !ID_RE.test(idRaw)) return IDEA_NOT_FOUND;
  const result = await runStaffAction("ideas_run", {}, async (ctx) => {
    const idea = await findIdea(ctx, idRaw);
    const r = await staffHideIdea(ctx, { id: idRaw });
    return {
      message: r.hidden
        ? `Hidden "${idea.title}". It is off the board and keeps its votes.`
        : `"${idea.title}" was already hidden; nothing changed.`,
    };
  });
  if (result.ok) refresh();
  return result;
}

/** Put an idea back on the board (clears a review hold). */
export async function unhideIdeaAction(
  idRaw: unknown,
): Promise<ActionResult<{ message: string }>> {
  if (typeof idRaw !== "string" || !ID_RE.test(idRaw)) return IDEA_NOT_FOUND;
  const result = await runStaffAction("ideas_run", {}, async (ctx) => {
    const idea = await findIdea(ctx, idRaw);
    const r = await staffUnhideIdea(ctx, { id: idRaw });
    return {
      message: r.shown
        ? `Shown "${idea.title}". It is back on the board.`
        : `"${idea.title}" was already on the board; nothing changed.`,
    };
  });
  if (result.ok) refresh();
  return result;
}

/** Fix the title (80) or description (2,000), e.g. to remove a business name. */
export async function editIdeaAction(
  idRaw: unknown,
  input: unknown,
): Promise<ActionResult<{ message: string }>> {
  if (typeof idRaw !== "string" || !ID_RE.test(idRaw)) return IDEA_NOT_FOUND;
  const obj =
    typeof input === "object" && input !== null && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const edit: { id: string; title?: string; description?: string } = {
    id: idRaw,
  };
  if (Object.hasOwn(obj, "title")) {
    const t = obj.title;
    if (typeof t !== "string" || !t.trim()) return bad("Add a title.", "title");
    if (t.trim().length > IDEA_TITLE_MAX) {
      return bad(`Use ${IDEA_TITLE_MAX} characters or fewer.`, "title");
    }
    edit.title = t.trim();
  }
  if (Object.hasOwn(obj, "description")) {
    const d = obj.description;
    if (typeof d !== "string") return bad("Add a description.", "description");
    if (d.trim().length > IDEA_DESCRIPTION_MAX) {
      return bad(
        `Use ${IDEA_DESCRIPTION_MAX.toLocaleString("en-US")} characters or fewer.`,
        "description",
      );
    }
    edit.description = d.trim();
  }
  if (edit.title === undefined && edit.description === undefined) {
    return bad("Change the title or the description first.", "title");
  }
  const result = await runStaffAction("ideas_run", {}, async (ctx) => {
    const r = await staffEditIdea(ctx, edit);
    return {
      message:
        r.changed.length > 0
          ? `Saved: ${r.changed.join(" and ")} changed.`
          : "Nothing to change; the idea already reads that way.",
    };
  });
  if (result.ok) refresh();
  return result;
}

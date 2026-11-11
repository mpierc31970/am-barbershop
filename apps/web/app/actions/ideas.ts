"use server";
// Suggest a feature (12-27 choice 3; CUSTOM-01, D297; T-12-27-01, T-12-27-02). A public POST
// endpoint: every argument is untrusted. The tenant, role and impersonation come only from
// the session cookie via runAction; no action takes an org id, and only the `title` and
// `description` own keys are read from the input. submitIdea (12-22) files the private
// suggestion ticket and the public card with this site's vote; a scanner-flagged idea is held
// hidden for CDS review (`held`), and the form then says so instead of linking to the card.
// support:write is deny-listed under impersonation (IMPERSONATING-SUPPORT); the shared 20/day
// ticket limit comes back as code "rate_limited" (the form shows RATE-TICKETS). Nothing here
// logs idea text.
import { InvalidInput } from "@cds/core";
import { submitIdea } from "@cds/db";
import { SUPPORT_UI_COPY } from "@cds/ui/hub/support";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "../../lib/action";

/** The chokepoint caps are 80 / 2,000 (P12-P5); refuse far larger payloads before that. */
const MAX_TITLE = 400;
const MAX_DESCRIPTION = 4000;
const TOO_LONG = "That idea is too long. Shorten it and try again.";

const COPY = { impersonation: SUPPORT_UI_COPY.IMPERSONATING_SUPPORT };

function own(raw: unknown, key: string): unknown {
  if (typeof raw !== "object" || raw === null) return undefined;
  return Object.prototype.hasOwnProperty.call(raw, key)
    ? (raw as Record<string, unknown>)[key]
    : undefined;
}

function textOf(raw: unknown, max: number): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string") throw new InvalidInput(TOO_LONG);
  if (raw.length > max) throw new InvalidInput(TOO_LONG);
  return raw;
}

export type PostedIdea = { id: string; held: boolean };

/** Get help → Suggest a feature: post one idea for the session's org. */
export async function submitIdeaAction(
  input: unknown,
): Promise<ActionResult<PostedIdea>> {
  const res = await runAction(async (s): Promise<PostedIdea> => {
    const title = textOf(own(input, "title"), MAX_TITLE);
    const description = textOf(own(input, "description"), MAX_DESCRIPTION);
    const out = await submitIdea(s.ctx, { title, description });
    return { id: out.ideaId, held: out.held };
  }, COPY);
  if (res.ok) {
    try {
      revalidatePath("/hub/support");
      revalidatePath("/hub", "layout");
    } catch (err) {
      console.error(
        "[support] revalidate failed",
        err instanceof Error ? err.name : typeof err,
      );
    }
  }
  return res;
}

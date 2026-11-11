"use server";
// Site settings saves from Website › Site settings and the Navigation tab's Search switch
// (CONT-29; CONT-15 toggle; 07-26 choices 2, 9; T-07-26-01, T-07-26-02). A public POST
// endpoint: the argument is untrusted. The tenant comes only from the session via
// runAction; only the four setting keys are copied (Object.hasOwn), so `organization`,
// `held`, `seo` and unknown keys never reach @cds/db. The chokepoint validates deny by
// default, merges under the org lock and invalidates the live tag.
// 07-30 (CONT-28, T-07-30-04): `share_image` (a library photo id) is the fifth key; the
// chokepoint checks it belongs to the org and is a ready photo.
// 11-24 (DASH-37, D305; T-11-24-03): setSensitivePracticeAction, the Settings › Business info
// switch. Only "on" | "off" pass; the chokepoint checks settings:write, refuses impersonating
// staff and audits every change.
// 12-17 (COMM-11, D102): a settings save refused by a CDS service window parks the picked
// patch as this person's held draft first (parkIfLocked; one held patch per person).
import type { SiteSettingsGroup, SiteSettingsPatch } from "@cds/core/content";
import {
  saveSiteSettings,
  setSensitivePractice,
  type AlertProfileFacts,
} from "@cds/db";
import { runAction, type ActionResult } from "../../lib/action";
import { contentDeps } from "../../lib/content";
import { parkIfLocked } from "../../lib/editor-lock";

const KEYS = [
  "language",
  "show_translate",
  "show_search",
  "allow_ai_crawlers",
  "share_image",
] as const;

export async function saveSiteSettingsAction(
  input: SiteSettingsPatch,
): Promise<ActionResult<{ settings: SiteSettingsGroup }>> {
  const raw: unknown = input;
  const picked: Record<string, unknown> = {};
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>;
    for (const k of KEYS) if (Object.hasOwn(r, k)) picked[k] = r[k];
  }
  return runAction(async (s) => {
    try {
      return await saveSiteSettings(s.ctx, contentDeps(), picked);
    } catch (err) {
      await parkIfLocked(s.ctx, err, {
        kind: "site_part",
        part: "settings",
        value: picked,
      });
      throw err;
    }
  });
}

const SENSITIVE_IMPERSONATING_COPY =
  "You're viewing as support staff, so sensitive-practice mode can't be changed. Only the owner or an admin can change it.";

/** Settings › Business info: sensitive-practice mode on or off (Owner, Admin). */
export async function setSensitivePracticeAction(
  value: unknown,
): Promise<ActionResult<AlertProfileFacts>> {
  if (value !== "on" && value !== "off") {
    return {
      ok: false,
      code: "invalid_input",
      message: "That didn't work. Reload the page and try again.",
    };
  }
  return runAction((s) => setSensitivePractice(s.ctx, value), {
    impersonation: SENSITIVE_IMPERSONATING_COPY,
  });
}

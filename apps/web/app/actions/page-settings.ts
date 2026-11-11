"use server";
// Page settings actions (CONT-28; D235 #11/#12, D-UI-P7-14; 07-32 choices 9, 13; T-07-32-06).
// Public POST endpoints: arguments are untrusted. The tenant comes only from the session via
// runAction. savePageSettingsAction copies exactly two keys with Object.hasOwn: `password`
// (a string, or null to turn protection off; present only when the owner typed one or turned
// protection off) and `inMenu` (boolean). `organization` and unknown keys never reach @cds/db.
// The password is set first and goes live at once; the menu change runs after it, and a menu
// failure never undoes the password (`inMenuError: true`). The password never reaches a log,
// a toast or a return value.
import { navHasPage } from "@cds/core/content";
import {
  addPageToNav,
  ensureNotFoundPage,
  getNav,
  getPage,
  removePageFromNav,
  setPagePassword,
  type PageSummary,
} from "@cds/db";
import { redirect } from "next/navigation";
import { runAction, type ActionResult } from "../../lib/action";
import { contentDeps } from "../../lib/content";

export type PageSettingsInput = { password?: string | null; inMenu?: boolean };

export type PageSettingsResult = {
  page: PageSummary;
  inMenu: boolean;
  inMenuError?: true;
};

/** The allowlisted copy of an untrusted settings input (exported for tests). */
export async function pickPageSettings(
  input: unknown,
): Promise<PageSettingsInput> {
  const out: PageSettingsInput = {};
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return out;
  }
  const r = input as Record<string, unknown>;
  if (Object.hasOwn(r, "password")) {
    const v = r.password;
    if (v === null || typeof v === "string") out.password = v;
  }
  if (Object.hasOwn(r, "inMenu") && typeof r.inMenu === "boolean") {
    out.inMenu = r.inMenu;
  }
  return out;
}

export async function savePageSettingsAction(
  pageId: string,
  input: PageSettingsInput,
): Promise<ActionResult<PageSettingsResult>> {
  const id = typeof pageId === "string" ? pageId : "";
  const clean = await pickPageSettings(input);
  return runAction(async (s) => {
    const deps = contentDeps();
    const page: PageSummary =
      clean.password !== undefined
        ? await setPagePassword(s.ctx, id, { password: clean.password }, deps)
        : await getPage(s.ctx, id);
    let inMenu = navHasPage(await getNav(s.ctx), page.id);
    if (clean.inMenu !== undefined && clean.inMenu !== inMenu) {
      try {
        if (clean.inMenu) {
          inMenu = (await addPageToNav(s.ctx, deps, page.id)).added || inMenu;
        } else {
          await removePageFromNav(s.ctx, deps, page.id);
          inMenu = false;
        }
      } catch {
        console.error("[hub] page settings menu change failed");
        return { page, inMenu, inMenuError: true as const };
      }
    }
    return { page, inMenu };
  });
}

/** Website › Pages "Page not found": create the 404 page on first open, then open it. */
export async function openNotFoundPageAction(): Promise<void> {
  const res = await runAction((s) => ensureNotFoundPage(s.ctx));
  if (!res.ok) redirect("/hub/website?tab=pages");
  redirect(`/hub/website/pages/${res.data.id}`);
}

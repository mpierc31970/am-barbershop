"use server";
// Pop-up actions for the Website › Pop-ups tab (CONT-12, CONT-31; D118, D124, D248, D253,
// D275; T-03-58..T-03-61). Public POST endpoints: every argument is untrusted. The tenant
// comes only from the session cookie via runAction, and only known pop-up fields are
// forwarded. The chokepoint validates and sanitizes the content, checks every page id in
// "Only these pages" belongs to the site (a foreign id reads as not found), screens the
// text, invalidates the live tag and pings the stand-in. A held save or switch-on is a
// success with held: true (the pop-up stays off). Delete follows D275 (07-28): a used pop-up
// is soft-deleted (keeps opening from its buttons), an unused one is deleted for good.
import type { PopupRecord } from "@cds/core/content";
import {
  deletePopup,
  popupUsage,
  savePopup,
  setPopupEnabled,
  type DeleteOutcome,
  type PopupUsage,
} from "@cds/db";
import { runAction, type ActionResult } from "../../lib/action";
import { contentDeps } from "../../lib/content";

export type DeletePopupResult = ActionResult<DeleteOutcome>;

const FIELDS = [
  "name",
  "content",
  "trigger",
  "delay_seconds",
  "scroll_percent",
  "frequency",
  "show_on",
  "page_ids",
  "enabled",
] as const;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function record(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/** Create (no id) or update a pop-up. */
export async function savePopupAction(
  input: Record<string, unknown>,
): Promise<ActionResult<{ popup: PopupRecord; held: boolean }>> {
  const raw = record(input);
  const clean: { id?: string } & Record<string, unknown> = {};
  for (const key of FIELDS) {
    if (Object.hasOwn(raw, key)) clean[key] = raw[key];
  }
  if (raw.id !== undefined) clean.id = str(raw.id);
  return runAction((s) => savePopup(s.ctx, contentDeps(), clean));
}

/** The list row's Show pop-up switch. Switching on re-screens it (held stays off). */
export async function setPopupEnabledAction(
  id: string,
  enabled: boolean,
): Promise<ActionResult<{ held: boolean }>> {
  return runAction((s) =>
    setPopupEnabled(s.ctx, contentDeps(), str(id), enabled === true),
  );
}

/** Where the pop-up is used; the delete dialog picks its body from it. */
export async function popupUsageAction(
  id: string,
): Promise<ActionResult<PopupUsage>> {
  return runAction((s) => popupUsage(s.ctx, contentDeps(), str(id)));
}

/** Delete a pop-up: soft when anything uses it, else for good (D275). */
export async function deletePopupAction(
  id: string,
): Promise<DeletePopupResult> {
  return runAction((s) => deletePopup(s.ctx, contentDeps(), str(id)));
}

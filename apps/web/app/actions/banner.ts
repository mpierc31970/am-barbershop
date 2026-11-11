"use server";
// Banner save from the Website › Banner tab (CONT-11, CONT-31; D117, D123, D248, D253;
// T-03-58, T-03-60). A public POST endpoint: every argument is untrusted. The tenant comes
// only from the session cookie via runAction, and only the six banner fields are
// forwarded. The chokepoint validates (safeHref link, UTC instants, end after start),
// screens the text, invalidates the live tag and pings the stand-in. A held result is a
// success with held: true (the banner was saved switched off).
// 12-17 (COMM-11, D102): a save refused by a CDS service window parks the cleaned input as
// this person's held draft first (parkIfLocked).
import type { BannerSettings } from "@cds/core/content";
import { saveBanner } from "@cds/db";
import { runAction, type ActionResult } from "../../lib/action";
import { contentDeps } from "../../lib/content";
import { parkIfLocked } from "../../lib/editor-lock";

function record(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

const FIELDS = [
  "enabled",
  "message",
  "link_text",
  "link_url",
  "starts_at",
  "ends_at",
] as const;

export async function saveBannerAction(
  input: BannerSettings,
): Promise<ActionResult<{ banner: BannerSettings; held: boolean }>> {
  const raw = record(input);
  const clean: Record<string, unknown> = {};
  for (const key of FIELDS) {
    if (Object.hasOwn(raw, key)) clean[key] = raw[key];
  }
  return runAction(async (s) => {
    try {
      return await saveBanner(s.ctx, contentDeps(), clean);
    } catch (err) {
      await parkIfLocked(s.ctx, err, {
        kind: "site_part",
        part: "banner",
        value: clean,
      });
      throw err;
    }
  });
}

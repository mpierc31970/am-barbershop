// Site footer chokepoint (CONT-13; D117 / invariant 6, D248, D249, D253; 07-25 choices 1-3;
// invariant 1, TEN-03; T-07-25-01..05). Same shape as saveNav: permission ->
// rejectForeignOrg -> validateFooter -> extra-link pages owned -> screen labels, copyright
// and web addresses (held = no extra links and the default copyright on the site) -> the one
// upsert -> afterLiveSave. The Report link (D249) is not stored anywhere and cannot be
// switched off.
import {
  navRefs,
  parseNavTarget,
  validateFooter,
  type FooterSettings,
} from "@cds/core/content";
import type { OrgContext } from "../../context";
import { requirePermission, tenantRepo } from "../../repository";
import type { ContentDeps } from "../ports";
import { afterLiveSave, screen } from "../screen";
import { rejectForeignOrg } from "../shared";
import { assertNavRefsOwned } from "./refs";
import { writeSiteSettingsPart } from "./write";

const COLLECTION = "site_settings";

/** The org's footer settings, or null when never saved (or malformed). */
export async function getFooter(
  ctx: OrgContext,
): Promise<FooterSettings | null> {
  const res = await tenantRepo(COLLECTION).list(ctx, { perPage: 1 });
  const row = res.items[0];
  if (!row || row.footer === null || row.footer === undefined) return null;
  try {
    return validateFooter(row.footer);
  } catch {
    return null;
  }
}

export async function saveFooter(
  ctx: OrgContext,
  deps: ContentDeps,
  raw: unknown,
): Promise<{ footer: FooterSettings; held: boolean }> {
  requirePermission(ctx, "content", "write");
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    rejectForeignOrg(ctx, raw as Record<string, unknown>);
  }
  const v = validateFooter(raw);
  const refs = navRefs({
    items: v.extra_links.map((l) => ({ ...l, children: [] })),
    cta: null,
    held: false,
  });
  await assertNavRefsOwned(ctx, refs);
  const texts = [...v.extra_links.map((l) => l.label), v.copyright].filter(
    (t) => t !== "",
  );
  const urls = v.extra_links
    .map((l) => l.target)
    .filter((t) => parseNavTarget(t)?.kind === "url");
  const outcome = await screen(ctx, deps, texts, urls);
  const held = outcome.verdict === "held";
  const footer: FooterSettings = { ...v, held };
  const id = await writeSiteSettingsPart(ctx, "footer", footer);
  await afterLiveSave(ctx, deps, outcome, { collection: COLLECTION, id });
  return { footer, held };
}

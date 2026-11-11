// P8 (08-15): the page write rules auto-assembly runs through (TMPL-02, TMPL-03; CONTEXT
// A2-Q3, A2-Q4; RESEARCH R-5, Pitfalls 4-5; invariants 1, 9; T-08-15-01..04).
//
// Rules only: no template knowledge, no publishing, no intake reads. The orchestrator
// (08-16) hands in a page's blocks and its ledger entry and gets back an outcome. Every
// write goes through an existing org-scoped chokepoint (createPage, saveSection,
// replacePageSections, saveNav, saveFooter), so tenant isolation stays in the repository
// layer (invariant 1).
//
// The page rules (installer seedPage shape, R-5):
//   - no ledger entry: every page (Home, About, ...) adopts an empty, never-published page
//     at its template slug, or creates one when the org has none; a page there with blocks
//     or a publish is left alone (skipped_existing, WR-A06). A new non-Home page takes the
//     first free slug of slugCandidates (only when the template slug is reserved).
//   - the ledger entry `{ id, slug, pending: true, print }` is saved BEFORE any block, and
//     again with the refreshed draft print (pageDraftPrint(page, blocks), read through
//     readPageDraft) after each block, so a crash mid-page resumes on the same page and
//     never makes a second one (A2-Q4).
//   - ledger entry present: page gone = deleted (never recreated, invariant 9); pending or
//     a re-run with the draft print still equal to the ledger print = rebuilt in one
//     replacePageSections batch ("created" when it finishes a first run); a different
//     print = edited (left alone); not pending and not a re-run = unchanged.
//   - a first-run page (pending, never published) whose print moved is checked against the
//     template first (CR-A01): a crash between a write and its ledger save leaves the page
//     one block ahead of the ledger print (or, after a whole-page replace or a publish, with
//     every template block). That is assembly's own work, so the page is finished. Anything
//     else throws RESUME_DIVERGED: a half-built page is never reported "edited" and the run
//     never finishes as done around it.
// Errors leave as AssemblyStepError: a code and the page key only, never a chokepoint
// message or intake text (T-08-15-04).
import { CdsError } from "@cds/core";
import { appendPageLink, type SectionRegistry } from "@cds/core/content";
import type { LedgerPage, PageOutcome } from "@cds/core/templates";
import { slugCandidates } from "../addons/installer";
import type { OrgContext } from "../context";
import { getFooter, saveFooter } from "../content/chrome/footer";
import { getNav, saveNav } from "../content/chrome/nav";
import { pageDraftPrint, readPageDraft } from "../content/draft-print";
import {
  createPage,
  HOME_SLUG,
  listPages,
  SlugReserved,
  SlugTaken,
} from "../content/pages";
import type { ContentDeps } from "../content/ports";
import {
  listSections,
  replacePageSections,
  saveSection,
  type ReplaceSectionInput,
  type SectionAddonOwners,
} from "../content/sections";
import { newRecordId } from "../repository";
import type { ObjectStore } from "../storage";

export type AssemblyStepCode =
  "CREATE_PAGE_FAILED" | "SECTION_FAILED" | "NAV_FAILED" | "RESUME_DIVERGED";

/** A failed assembly step: the code and the page key only (T-08-15-04). */
export class AssemblyStepError extends CdsError {
  override readonly code: AssemblyStepCode;
  readonly page: string | undefined;
  constructor(code: AssemblyStepCode, page?: string) {
    super(code);
    this.code = code;
    this.page = page;
  }
}

/** One block a template page asks for; `band` becomes settings.background_variant. */
export type TemplateBlock = {
  section_type: string;
  row_layout: string;
  content: unknown;
  band: "main" | "alternate";
};

export type WriteTemplatePageInput = {
  /** The template's page key ("home", "about", ...); also the step error's page. */
  pageKey: string;
  slug: string;
  title: string;
  /** The page's menu label for report lines ("About"); defaults to the capitalised key. */
  label?: string;
  blocks: readonly TemplateBlock[];
  /** The ledger entry from an earlier run, if any. */
  ledgerPage: LedgerPage | undefined;
  /** An explicit re-run (site:assemble --rerun): rebuild pages nobody touched. */
  rerun: boolean;
  store?: ObjectStore;
  /** Persists the ledger entry; called before the first block and after each one. */
  savePage: (page: LedgerPage) => Promise<void>;
};

export type WriteTemplatePageResult = {
  outcome: PageOutcome;
  /** The ledger entry to keep (null only when nothing was written: skipped_existing). */
  page: LedgerPage | null;
  /** One "To polish" line for the report, when the page needs the owner's eye. */
  polish?: string;
};

/** The report line for a template page that already existed with the owner's content. */
export function leftAloneLine(label: string): string {
  return `${label} · Already existed: left alone`;
}

export const HOME_LEFT_ALONE = leftAloneLine("Home");

function labelOf(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

async function step<T>(
  code: AssemblyStepCode,
  page: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AssemblyStepError) throw err;
    throw new AssemblyStepError(code, page);
  }
}

/** The page's current draft print; a vanished page is a failed step. */
async function printOf(
  ctx: OrgContext,
  pageId: string,
  code: AssemblyStepCode,
  key: string,
): Promise<string> {
  const draft = await step(code, key, () => readPageDraft(ctx, pageId));
  if (!draft) throw new AssemblyStepError(code, key);
  return draft.print;
}

function toSection(b: TemplateBlock): ReplaceSectionInput {
  return {
    section_type: b.section_type,
    row_layout: b.row_layout,
    content: b.content,
    settings: {
      background_variant: b.band === "alternate" ? "alternate" : "main",
    },
  };
}

/** The ledger entry without the pending marker (a page assembly no longer finishes). */
function settled(p: LedgerPage): LedgerPage {
  return {
    id: p.id,
    slug: p.slug,
    print: p.print,
    published: p.published,
    ...(p.versionKey !== undefined ? { versionKey: p.versionKey } : {}),
  };
}

type PageDraft = NonNullable<Awaited<ReturnType<typeof readPageDraft>>>;

/**
 * Is a first-run page whose print no longer matches the ledger still assembly's own,
 * unfinished work (CR-A01)? Its blocks must be a prefix of the template's (by type), and
 * either every template block is there (a whole-page replace or a publish landed after the
 * last ledger save) or the page minus its last block still has the ledger print (one
 * saveSection landed after the last ledger save). Pure.
 */
export function isOwnUnfinished(
  draft: Pick<PageDraft, "page" | "blocks">,
  ledgerPage: LedgerPage,
  blocks: readonly TemplateBlock[],
): boolean {
  if (ledgerPage.pending !== true || ledgerPage.published) return false;
  const n = draft.blocks.length;
  if (n === 0 || n > blocks.length) return false;
  for (let i = 0; i < n; i++) {
    if (String(draft.blocks[i]!.section_type) !== blocks[i]!.section_type) {
      return false;
    }
  }
  if (n === blocks.length) return true;
  return (
    pageDraftPrint(draft.page, draft.blocks.slice(0, n - 1)) ===
    ledgerPage.print
  );
}

/** Create the page at the first free candidate slug. */
async function createAtFree(
  ctx: OrgContext,
  input: WriteTemplatePageInput,
  candidates: readonly string[],
): Promise<{ id: string; slug: string }> {
  for (const slug of candidates) {
    try {
      const p = await createPage(
        ctx,
        { title: input.title, slug },
        input.store,
      );
      return { id: p.id, slug: p.slug };
    } catch (err) {
      if (err instanceof SlugTaken || err instanceof SlugReserved) continue;
      throw new AssemblyStepError("CREATE_PAGE_FAILED", input.pageKey);
    }
  }
  throw new AssemblyStepError("CREATE_PAGE_FAILED", input.pageKey);
}

/** Rebuild an untouched page from the ledger in one batch. */
async function rebuild(
  ctx: OrgContext,
  registry: SectionRegistry,
  input: WriteTemplatePageInput,
  ledgerPage: LedgerPage,
  addons: SectionAddonOwners | undefined,
): Promise<WriteTemplatePageResult> {
  const key = input.pageKey;
  const firstRun = ledgerPage.pending === true && !ledgerPage.published;
  const pending: LedgerPage = { ...ledgerPage, pending: true };
  await input.savePage(pending);
  await step("SECTION_FAILED", key, () =>
    replacePageSections(
      ctx,
      registry,
      ledgerPage.id,
      input.blocks.map(toSection),
      addons,
    ),
  );
  const page: LedgerPage = {
    ...pending,
    print: await printOf(ctx, ledgerPage.id, "SECTION_FAILED", key),
  };
  await input.savePage(page);
  return { outcome: firstRun ? "created" : "rebuilt", page };
}

/**
 * Write one template page under the rules above. Publishing is not done here: the returned
 * entry stays `pending: true` until 08-16 publishes the page and records its versionKey
 * (and the print the publish leaves), so a crash before the publish resumes the page.
 */
export async function writeTemplatePage(
  ctx: OrgContext,
  registry: SectionRegistry,
  input: WriteTemplatePageInput,
  addons?: SectionAddonOwners,
): Promise<WriteTemplatePageResult> {
  const key = input.pageKey;
  const ledgerPage = input.ledgerPage;

  if (ledgerPage) {
    const draft = await step("SECTION_FAILED", key, () =>
      readPageDraft(ctx, ledgerPage.id),
    );
    if (!draft) return { outcome: "deleted", page: settled(ledgerPage) };
    if (!ledgerPage.pending && !input.rerun) {
      return { outcome: "unchanged", page: ledgerPage };
    }
    if (draft.print !== ledgerPage.print) {
      const firstRun = ledgerPage.pending === true && !ledgerPage.published;
      if (!firstRun) return { outcome: "edited", page: settled(ledgerPage) };
      // A half-built page is finished when the change is assembly's own, else the run
      // fails so staff are told (never "edited" + done around it, CR-A01).
      if (!isOwnUnfinished(draft, ledgerPage, input.blocks)) {
        throw new AssemblyStepError("RESUME_DIVERGED", key);
      }
    }
    return rebuild(ctx, registry, input, ledgerPage, addons);
  }

  // Every template page follows the Home rule (WR-A06): a page already at the template slug
  // is adopted when empty and never published, else left alone. Never a second About at
  // about-2 with a second menu link.
  let target: { id: string; slug: string };
  const pages = await step("CREATE_PAGE_FAILED", key, () => listPages(ctx));
  const existing = pages.find((p) => p.slug === input.slug);
  if (existing) {
    const blocks = await step("CREATE_PAGE_FAILED", key, () =>
      listSections(ctx, existing.id),
    );
    const untouched =
      blocks.length === 0 &&
      existing.status === "draft" &&
      existing.published_at === null;
    if (!untouched) {
      return {
        outcome: "skipped_existing",
        page: null,
        polish: leftAloneLine(input.label ?? labelOf(key)),
      };
    }
    target = { id: existing.id, slug: existing.slug };
  } else {
    target = await createAtFree(
      ctx,
      input,
      key === "home" ? [HOME_SLUG] : slugCandidates(input.slug),
    );
  }

  // Ledger first: a failure below never leads a retry to a second page (A2-Q4).
  let page: LedgerPage = {
    id: target.id,
    slug: target.slug,
    pending: true,
    print: await printOf(ctx, target.id, "CREATE_PAGE_FAILED", key),
    published: false,
  };
  await input.savePage(page);
  for (const block of input.blocks) {
    await step("SECTION_FAILED", key, () =>
      saveSection(
        ctx,
        registry,
        { pageId: target.id, ...toSection(block) },
        addons,
      ),
    );
    page = {
      ...page,
      print: await printOf(ctx, target.id, "SECTION_FAILED", key),
    };
    await input.savePage(page);
  }
  return { outcome: "created", page };
}

/**
 * Put the assembled pages in the site menu by page id: only the missing ones are appended,
 * in the order given; existing entries (add-on pages included) keep their place. A deleted
 * page is simply not passed. One saveNav when anything changed (it checks every page is
 * the org's own, so a foreign id fails as NAV_FAILED and writes nothing).
 */
export async function ensureAssemblyNav(
  ctx: OrgContext,
  deps: ContentDeps,
  pages: readonly { id: string; label: string }[],
): Promise<{ added: number }> {
  return step("NAV_FAILED", undefined, async () => {
    let nav = await getNav(ctx);
    let added = 0;
    for (const p of pages) {
      const res = appendPageLink(nav, {
        pageId: p.id,
        title: p.label,
        id: newRecordId(),
      });
      if (res.added) {
        nav = res.nav;
        added += 1;
      }
    }
    if (added > 0 && nav) await saveNav(ctx, deps, nav);
    return { added };
  });
}

/**
 * Footer defaults for a footer that was never saved: address, hours summary and socials on,
 * no extra links, the default copyright. A saved footer is the owner's and is not touched.
 * Failures report as NAV_FAILED (the site chrome step).
 */
export async function ensureFooterDefaults(
  ctx: OrgContext,
  deps: ContentDeps,
): Promise<{ written: boolean }> {
  return step("NAV_FAILED", undefined, async () => {
    if ((await getFooter(ctx)) !== null) return { written: false };
    await saveFooter(ctx, deps, {
      show_address: true,
      show_hours: true,
      show_socials: true,
      extra_links: [],
      copyright: "",
    });
    return { written: true };
  });
}

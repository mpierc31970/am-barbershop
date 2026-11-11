// P8 (08-16): the provisioner. A `ready_for_build` org's intake becomes a published Home and
// About (TMPL-02), through one injected template (TMPL-03), with a stage change, a stored
// report and an audit row (TMPL-04). CONTEXT A2-Q2..Q5, A3-Q5, A4-Q2; RESEARCH R-2, R-4,
// R-5, R-7, Pitfalls 3-6; D47, D183, D184, D254; invariants 1, 9.
//
// Rules this module keeps:
//   - Templates are injected (`deps.templates`). Never import the templates package here:
//     a second template must provision through this function unchanged (TMPL-03).
//   - Slot fills are pure. The contact form id is created first and passed in as a ref.
//   - Every page write goes through 08-15's writeTemplatePage / ensureAssemblyNav /
//     ensureFooterDefaults (existing org-scoped chokepoints); publishing through publishPage
//     (scan, published JSON, a version per publish: D184, D254). The ledger keeps each page's
//     versionKey (R-7, DASH-07 labels it "Set up by CDS from your answers").
//   - The ledger (`org_intake.assembly`) makes runs idempotent and resumable (A2-Q3, A2-Q4).
//     A run is claimed (`running`, attempts + 1) before any write; a held publish is
//     reported, not failed (Pitfall 3).
//   - On success the ledger (`done`), the stage (`ready_for_build` -> `being_built` only) and
//     the `site.assembled` audit row go in one PocketBase batch. The org theme is read only
//     to flag the neutral preset; it is never written (D47).
//   - Runs of one org are serialised on their own lock key `assembly:<org>` (the content
//     lock is not re-entrant and the chokepoints below take it), and across processes by
//     a platform_meta lock row `lock:assembly:<org>` (WR-A05).
//   - Errors leave as a code (and page key) only: `[assembly] <CODE>` in logs, never a
//     message or intake text (T-08-16-08).
import type { AddonRegistry } from "@cds/core/addons";
import { newId, type SectionRegistry } from "@cds/core/content";
import { findBusinessType } from "@cds/core/onboarding";
import {
  assertTemplateShape,
  assignBands,
  photoPolishLine,
  pickTemplate,
  type AssemblyIntake,
  type AssemblyLedger,
  type AssemblyReport,
  type CopyWriter,
  type LedgerPage,
  type PageOutcome,
  type SiteTemplate,
  type SlotReportLine,
  type SlotResult,
} from "@cds/core/templates";
import { NotFound } from "@cds/core";
import type PocketBase from "pocketbase";
import { ClientResponseError } from "pocketbase";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import { withOrgLock } from "../content/lock";
import { readPageDraft } from "../content/draft-print";
import { HOME_SLUG, listPages } from "../content/pages";
import type {
  ContentScanner,
  Invalidator,
  SearchPinger,
} from "../content/ports";
import { publishPage, type PublishDeps } from "../content/publish";
import { listSections } from "../content/sections";
import {
  assertOrgContext,
  mintSystemContext,
  type OrgContext,
} from "../context";
import { createForm, listForms } from "../forms/forms";
import { getIntakeForAssembly } from "../intake/assembly";
import { activeAddons } from "../addons/entitlements";
import { acquirePlatformLock, releasePlatformLock } from "../platform-meta";
import { mapError } from "../repository";
import type { ObjectStore } from "../storage";
import { readOrganizationDesign } from "../theme";
import { emptyLedger, parseLedger, readLedger, writeLedger } from "./ledger";
import { ensurePreviewHost } from "./preview-host";
import {
  AssemblyStepError,
  ensureAssemblyNav,
  ensureFooterDefaults,
  isOwnUnfinished,
  leftAloneLine,
  writeTemplatePage,
  type TemplateBlock,
} from "./page-writes";

export type AssemblyDeps = {
  templates: readonly SiteTemplate[];
  sections: SectionRegistry;
  copy: CopyWriter;
  /** Defaults to a no-op recorder (apps/web passes revalidateTag). */
  invalidator?: Invalidator;
  scanner?: ContentScanner;
  pinger?: SearchPinger;
  store?: ObjectStore;
  publicStore?: ObjectStore;
  /** Test seam: the publish step (default publishPage). */
  publish?: typeof publishPage;
};

export type AssemblyOptions = {
  /** Rebuild pages nobody touched (site:assemble --rerun). */
  rerun?: boolean;
  /** Report only: nothing is claimed or written. */
  dryRun?: boolean;
  now?: Date;
  /**
   * Who the `site.assembled` audit row names. "system" (the queue/sweep run, R-2): a
   * system-job row; "context" (default; staff runs): the calling context.
   */
  auditAs?: "system" | "context";
};

export type AssemblyStatus =
  "done" | "already" | "busy" | "not_ready" | "no_template" | "failed";

export type AssemblyFacts = {
  businessName: string;
  businessTypeLabel: string;
  path: string;
};

export type AssemblyResult = {
  status: AssemblyStatus;
  ledger: AssemblyLedger;
  report: AssemblyReport | null;
  previewHost: string | null;
  dryRun: boolean;
  errorCode?: string;
  /** Business name, type label and path for the staff email (null before the intake read). */
  facts: AssemblyFacts | null;
};

export type AssemblyErrorCode =
  | "INTAKE_FAILED"
  | "HOST_FAILED"
  | "FORM_FAILED"
  | "VALIDATION_FAILED"
  | "PUBLISH_FAILED"
  | "NO_OWNER"
  | "FINISH_FAILED"
  | "FILL_FAILED"
  | "PREDICT_FAILED"
  | "LEDGER_FAILED"
  | "UNEXPECTED"
  | "CREATE_PAGE_FAILED"
  | "SECTION_FAILED"
  | "NAV_FAILED"
  | "RESUME_DIVERGED"
  | "NO_INTAKE"
  | "CLAIM_FAILED";

/** A failed run step: a code and the page key only. */
class AssemblyFail extends Error {
  readonly code: AssemblyErrorCode;
  readonly page: string | undefined;
  constructor(code: AssemblyErrorCode, page?: string) {
    super(code);
    this.code = code;
    this.page = page;
  }
}

/** A running claim older than this is treated as a crashed run (T-08-16-05). */
const STALE_MS = 30 * 60 * 1000;
/** Placeholder form id for a dry run on a site with no contact form yet (never written). */
const DRY_RUN_FORM = "dryrunform00000";
const LOGO_LINE = "Logo · None: business name shown instead";
const THEME_LINE = "Theme: import the impeccable theme (D45)";

async function guard<T>(
  code: AssemblyErrorCode,
  page: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AssemblyFail) throw err;
    if (err instanceof AssemblyStepError) throw err;
    throw new AssemblyFail(code, page);
  }
}

function pbRun<T>(fn: (pb: PocketBase) => Promise<T>): Promise<T> {
  return withSuperuser(fn).catch((err: unknown) => {
    if (err instanceof ClientResponseError) mapError(err);
    throw err;
  });
}

type OrgRow = { stage: string; path: string; name: string };

async function readOrg(ctx: OrgContext): Promise<OrgRow> {
  return pbRun(async (pb) => {
    const org = await pb
      .collection("organizations")
      .getOne(ctx.orgId, { fields: "id,stage,path,name" });
    const s = (v: unknown) => (typeof v === "string" ? v : "");
    return { stage: s(org.stage), path: s(org.path), name: s(org.name) };
  });
}

/** Page key -> the versionKey of the publish assembly made (R-7; DASH-07 labels these). */
export function assemblyVersionKeys(
  ledger: AssemblyLedger,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, page] of Object.entries(ledger.pages)) {
    if (page.versionKey !== undefined) out[key] = page.versionKey;
  }
  return out;
}

function pathOf(slug: string): string {
  return slug === HOME_SLUG ? "/" : `/${slug}`;
}

function factsOf(intake: AssemblyIntake, orgName: string): AssemblyFacts {
  const fields = intake.fields;
  const name = fields.org_name?.value;
  const type = fields.business_type;
  const typeId =
    type?.source === "provided" && typeof type.value === "string"
      ? type.value
      : "";
  return {
    businessName: typeof name === "string" && name !== "" ? name : orgName,
    businessTypeLabel: findBusinessType(typeId)?.label ?? typeId,
    path: intake.path,
  };
}

type FilledPage = {
  key: string;
  slug: string;
  title: string;
  navLabel: string;
  inNav: boolean;
  blocks: TemplateBlock[];
};

type Filled = {
  pages: FilledPage[];
  slots: SlotReportLine[];
  polish: string[];
  unreviewed: string[];
};

/** Fill every slot of every page (pure); `placed` grows across the site (08-14). */
function fillTemplate(
  template: SiteTemplate,
  intake: AssemblyIntake,
  env: {
    registry: AddonRegistry;
    copy: CopyWriter;
    active: ReadonlySet<string>;
    formId: string;
  },
): Filled {
  const sitePlaced = new Set<string>();
  const out: Filled = { pages: [], slots: [], polish: [], unreviewed: [] };
  for (const page of template.pages) {
    try {
      const pagePlaced = new Set<string>();
      // One contact form item id per page, minted before any slot runs: the hero links the
      // wrapper `form-<itemId>` the Contact slot places later on this page (G1, CR-B01).
      const contactFormItemId = newId();
      const raw: { slot: string; blocks: SlotResult["blocks"] }[] = [];
      for (const slot of page.slots) {
        const r = slot.fill(intake, {
          templateId: template.id,
          pageKey: page.key,
          activeAddons: env.active,
          addons: env.registry,
          copy: env.copy,
          refs: { contactFormId: env.formId, contactFormItemId },
          placed: new Set(sitePlaced),
          pagePlaced: new Set(pagePlaced),
        });
        raw.push({ slot: slot.name, blocks: r.blocks });
        const line: SlotReportLine = {
          page: page.key,
          slot: slot.name,
          source: r.source,
        };
        if (r.note !== undefined && r.note !== "") line.note = r.note;
        out.slots.push(line);
        for (const p of r.polish ?? []) out.polish.push(p);
        for (const id of r.unreviewedAlt ?? []) out.unreviewed.push(id);
        if (r.blocks.length > 0) {
          sitePlaced.add(slot.name);
          pagePlaced.add(slot.name);
        }
      }
      const banded = assignBands(raw, {
        hasHero: raw.some((r) => r.slot === "hero" && r.blocks.length > 0),
      });
      out.pages.push({
        key: page.key,
        slug: page.slug,
        title: page.title(intake),
        navLabel: page.navLabel,
        inNav: page.inNav,
        blocks: banded.flatMap((b) =>
          b.blocks.map((block) => ({
            section_type: block.section_type,
            row_layout: block.row_layout,
            content: block.content,
            band: b.band,
          })),
        ),
      });
    } catch {
      // A slot fill, page title or band step threw: a template bug, named as such (WR-A04).
      throw new AssemblyFail("FILL_FAILED", page.key);
    }
  }
  return out;
}

/** Every block must pass its registered type, layout and validator (fail fast). */
function validateBlocks(sections: SectionRegistry, pages: FilledPage[]): void {
  for (const page of pages) {
    for (const b of page.blocks) {
      const def = sections.get(b.section_type);
      if (!def || !(def.layouts as readonly string[]).includes(b.row_layout)) {
        throw new AssemblyFail("VALIDATION_FAILED", page.key);
      }
      try {
        def.validate(b.content, b.row_layout as never);
      } catch {
        throw new AssemblyFail("VALIDATION_FAILED", page.key);
      }
    }
  }
}

function dedupe(lines: readonly string[]): string[] {
  return [...new Set(lines)];
}

/** What a run would do to one page, without writing (dry run). */
async function predictOutcome(
  ctx: OrgContext,
  page: FilledPage,
  ledgerPage: LedgerPage | undefined,
  rerun: boolean,
): Promise<{ outcome: PageOutcome; polish?: string }> {
  if (ledgerPage) {
    const draft = await readPageDraft(ctx, ledgerPage.id);
    if (!draft) return { outcome: "deleted" };
    if (!ledgerPage.pending && !rerun) return { outcome: "unchanged" };
    if (
      draft.print !== ledgerPage.print &&
      !isOwnUnfinished(draft, ledgerPage, page.blocks)
    ) {
      // A diverged first-run page fails the real run (RESUME_DIVERGED, CR-A01).
      return { outcome: "edited" };
    }
    return {
      outcome:
        ledgerPage.pending === true && !ledgerPage.published
          ? "created"
          : "rebuilt",
    };
  }
  // Any template page already at its slug with content is left alone (WR-A06).
  const existing = (await listPages(ctx)).find((p) => p.slug === page.slug);
  if (existing) {
    const blocks = await listSections(ctx, existing.id);
    if (
      blocks.length > 0 ||
      existing.status !== "draft" ||
      existing.published_at !== null
    ) {
      return {
        outcome: "skipped_existing",
        polish: leftAloneLine(page.navLabel || page.key),
      };
    }
  }
  return { outcome: "created" };
}

/** The contact form: the ledger's, else a live "Contact…" form, else a new one. */
async function contactForm(
  ctx: OrgContext,
  deps: AssemblyDeps,
  ledger: AssemblyLedger,
  dryRun: boolean,
): Promise<string> {
  const forms = await listForms(ctx);
  // Only a live ledger form is kept: never bind blocks to a deleted or held one (WR-A02).
  const kept = forms.find(
    (f) => f.id === ledger.form_id && !f.deleted && !f.inReview,
  );
  if (kept) return kept.id;
  const live = forms.find(
    (f) => !f.deleted && !f.inReview && f.name.startsWith("Contact"),
  );
  if (live) return live.id;
  if (dryRun) return DRY_RUN_FORM;
  const made = await createForm(ctx, contentDeps(deps), {
    template: "contact",
  });
  return made.form.id;
}

function noopInvalidator(): Invalidator {
  return { invalidate() {} };
}

function contentDeps(deps: AssemblyDeps): PublishDeps {
  const out: PublishDeps = {
    sections: deps.sections,
    invalidator: deps.invalidator ?? noopInvalidator(),
  };
  if (deps.scanner) out.scanner = deps.scanner;
  if (deps.pinger) out.pinger = deps.pinger;
  if (deps.store) out.store = deps.store;
  if (deps.publicStore) out.publicStore = deps.publicStore;
  return out;
}

function settled(p: LedgerPage): LedgerPage {
  return {
    id: p.id,
    slug: p.slug,
    print: p.print,
    published: p.published,
    ...(p.versionKey !== undefined ? { versionKey: p.versionKey } : {}),
  };
}

/**
 * Provision the org's site from its intake (TMPL-02). Returns a status instead of throwing
 * for the expected cases (not ready, already done, busy, no template, failed).
 */
export async function assembleSite(
  ctx: OrgContext,
  registry: AddonRegistry,
  deps: AssemblyDeps,
  opts: AssemblyOptions = {},
): Promise<AssemblyResult> {
  assertOrgContext(ctx);
  const orgId = ctx.orgId;
  return withOrgLock(`assembly:${orgId}`, () =>
    runLocked(ctx, registry, deps, opts),
  );
}

/** The cross-process claim key of one org's run (WR-A05). */
export function assemblyLockKey(orgId: string): string {
  return `lock:assembly:${orgId}`;
}

/**
 * The in-process lock above only serialises one Node process. A real run also takes the
 * platform_meta lock row (a unique key: an atomic create), so the site:assemble CLI and the
 * web queue never assemble one org at once (WR-A05). The org and ledger are read after the
 * lock is held, so a run that waited never acts on a ledger read before the other finished.
 * A dry run writes nothing and takes no lock.
 */
async function runLocked(
  ctx: OrgContext,
  registry: AddonRegistry,
  deps: AssemblyDeps,
  opts: AssemblyOptions,
): Promise<AssemblyResult> {
  if (opts.dryRun === true) return runClaimed(ctx, registry, deps, opts);
  const key = assemblyLockKey(ctx.orgId);
  const token = await acquirePlatformLock(key, {
    now: opts.now ?? new Date(),
    staleMs: STALE_MS,
  });
  if (token === null) {
    const ledger = (await ledgerOrNull(ctx))?.ledger ?? emptyLedger();
    return {
      status: "busy",
      ledger,
      report: ledger.report ?? null,
      previewHost: null,
      dryRun: false,
      facts: null,
    };
  }
  try {
    return await runClaimed(ctx, registry, deps, opts);
  } finally {
    try {
      await releasePlatformLock(key, token);
    } catch {
      // A stuck row frees itself after STALE_MS.
      console.error("[assembly] UNLOCK_FAILED");
    }
  }
}

/** The org's ledger, or null when it has no org_intake row (WR-A08). */
async function ledgerOrNull(
  ctx: OrgContext,
): Promise<{ rowId: string; ledger: AssemblyLedger } | null> {
  try {
    return await readLedger(ctx);
  } catch (err) {
    if (err instanceof NotFound) return null;
    throw err;
  }
}

async function runClaimed(
  ctx: OrgContext,
  registry: AddonRegistry,
  deps: AssemblyDeps,
  opts: AssemblyOptions,
): Promise<AssemblyResult> {
  const rerun = opts.rerun === true;
  const dryRun = opts.dryRun === true;
  const now = opts.now ?? new Date();
  const org = await readOrg(ctx);
  const read = await ledgerOrNull(ctx);
  const rowId = read?.rowId ?? "";
  const stored = read?.ledger ?? emptyLedger();
  let ledger: AssemblyLedger = stored;

  const result = (
    status: AssemblyStatus,
    extra: Partial<AssemblyResult> = {},
  ): AssemblyResult => ({
    status,
    ledger,
    report: ledger.report ?? null,
    previewHost: null,
    dryRun,
    facts: null,
    ...extra,
  });

  if (org.stage !== "ready_for_build" && org.stage !== "being_built") {
    return result("not_ready");
  }
  if (read === null) {
    // No intake row: nothing to assemble from and nowhere to count an attempt. Returned as
    // a failure with its own code (never thrown); the sweep skips such orgs and the
    // monitor counts them as given up (WR-A08).
    console.error("[assembly] NO_INTAKE");
    return result("failed", { errorCode: "NO_INTAKE" });
  }
  if (!rerun && (org.stage === "being_built" || ledger.status === "done")) {
    return result("already");
  }
  if (ledger.status === "running" && ledger.started_at) {
    const started = Date.parse(ledger.started_at);
    if (Number.isFinite(started) && now.getTime() - started < STALE_MS) {
      return result("busy");
    }
  }
  const template = pickTemplate(deps.templates, org.path);
  if (!template) return result("no_template");

  // Persist the in-memory ledger (never in a dry run).
  const save = async (): Promise<void> => {
    if (dryRun) return;
    ledger = await writeLedger(ctx, rowId, ledger);
  };

  if (!dryRun) {
    const claimed: AssemblyLedger = {
      ...ledger,
      template_id: template.id,
      template_version: template.version,
      status: "running",
      attempts: ledger.attempts + 1,
      started_at: now.toISOString(),
    };
    delete claimed.error;
    try {
      ledger = await writeLedger(ctx, rowId, claimed);
    } catch {
      // The claim could not be stored (a code, never thrown past the run, WR-A08).
      console.error("[assembly] CLAIM_FAILED");
      return result("failed", { errorCode: "CLAIM_FAILED" });
    }
  }

  let facts: AssemblyFacts | null = null;
  let previewHost: string | null = null;
  try {
    await guard("VALIDATION_FAILED", undefined, async () =>
      assertTemplateShape(template),
    );
    const intake = await guard("INTAKE_FAILED", undefined, () =>
      getIntakeForAssembly(ctx, registry),
    );
    facts = factsOf(intake, org.name);
    if (!dryRun) {
      previewHost = await guard("HOST_FAILED", undefined, () =>
        ensurePreviewHost(ctx.orgId),
      );
    }
    const formId = await guard("FORM_FAILED", undefined, () =>
      contactForm(ctx, deps, ledger, dryRun),
    );
    if (!dryRun && ledger.form_id !== formId) {
      ledger = { ...ledger, form_id: formId };
      await save();
    }
    const active = new Set(
      await guard("INTAKE_FAILED", undefined, () => activeAddons(ctx)),
    );
    const filled = fillTemplate(template, intake, {
      registry,
      copy: deps.copy,
      active,
      formId,
    });
    validateBlocks(deps.sections, filled.pages);

    const outcomes = new Map<string, PageOutcome>();
    const pagePolish: string[] = [];
    const cdeps = contentDeps(deps);
    const publish = deps.publish ?? publishPage;

    for (const page of filled.pages) {
      const ledgerPage = ledger.pages[page.key];
      if (dryRun) {
        const p = await guard("PREDICT_FAILED", page.key, () =>
          predictOutcome(ctx, page, ledgerPage, rerun),
        );
        outcomes.set(page.key, p.outcome);
        if (p.polish) pagePolish.push(p.polish);
        continue;
      }
      const savePage = async (p: LedgerPage): Promise<void> => {
        ledger = { ...ledger, pages: { ...ledger.pages, [page.key]: p } };
        await guard("LEDGER_FAILED", page.key, save);
      };
      const written = await guard("SECTION_FAILED", page.key, () =>
        writeTemplatePage(
          ctx,
          deps.sections,
          {
            pageKey: page.key,
            slug: page.slug,
            title: page.title,
            label: page.navLabel || page.key,
            blocks: page.blocks,
            ledgerPage,
            rerun,
            ...(deps.store ? { store: deps.store } : {}),
            savePage,
          },
          registry,
        ),
      );
      if (written.polish) pagePolish.push(written.polish);
      let outcome = written.outcome;
      if (written.page && written.page !== ledgerPage) {
        await savePage(written.page);
      }
      if ((outcome === "created" || outcome === "rebuilt") && written.page) {
        const pageId = written.page.id;
        const res = await guard("PUBLISH_FAILED", page.key, () =>
          publish(ctx, pageId, { ...cdeps, now: () => now }),
        );
        const fresh = await guard("PUBLISH_FAILED", page.key, () =>
          readPageDraft(ctx, pageId),
        );
        const base = settled({
          ...written.page,
          print: fresh?.print ?? written.page.print,
        });
        if (res.status === "published") {
          await savePage({
            ...base,
            published: true,
            versionKey: res.versionKey,
          });
        } else {
          await savePage({ ...base, published: false });
          outcome = "held";
          const label = page.navLabel || page.key;
          pagePolish.push(`${label} · Held by the content check`);
        }
      }
      outcomes.set(page.key, outcome);
    }

    if (!dryRun) {
      // The menu is set up by the first assembly only (WR-A01): once a site has been
      // assembled the menu is the owner's, so a re-run never re-adds a link they removed.
      // Only live pages are linked: held, edited, deleted and skipped pages are not.
      if (stored.assembled_at === undefined) {
        const navPages = filled.pages
          .filter((p) => {
            const o = outcomes.get(p.key);
            return (
              p.inNav &&
              ledger.pages[p.key]?.published === true &&
              (o === "created" || o === "rebuilt" || o === "unchanged")
            );
          })
          .map((p) => ({ id: ledger.pages[p.key]!.id, label: p.navLabel }));
        await ensureAssemblyNav(ctx, cdeps, navPages);
      }
      await ensureFooterDefaults(ctx, cdeps);
    }

    // Report (A4-Q2): slot polish, page lines, one photo line, logo, theme.
    const polish = dedupe([...filled.polish, ...pagePolish]);
    const photo = photoPolishLine(filled.unreviewed);
    if (photo) polish.push(photo);
    if (!intake.media.logo) polish.push(LOGO_LINE);
    const design = await guard("INTAKE_FAILED", undefined, () =>
      readOrganizationDesign(ctx),
    );
    if (design === null) polish.push(THEME_LINE);
    const report: AssemblyReport = {
      templateId: template.id,
      templateVersion: template.version,
      slots: filled.slots,
      polish,
      pages: filled.pages.map((p) => {
        const lp = ledger.pages[p.key];
        return {
          key: p.key,
          label: p.navLabel || p.key,
          outcome: outcomes.get(p.key) ?? "unchanged",
          path: pathOf(lp?.slug ?? p.slug),
        };
      }),
    };

    if (dryRun) {
      return result("done", { report, facts, previewHost: null });
    }

    const done: AssemblyLedger = parseLedger({
      ...ledger,
      status: "done",
      assembled_at: now.toISOString(),
      report,
      // A success clears the failure count (WR-A03): a later failed re-run starts again at
      // 1 and never trips the 3-tries staff alert or the monitor's given-up count early.
      attempts: 0,
      failure_emailed: false,
    });
    delete done.error;
    await guard("FINISH_FAILED", undefined, () =>
      finish(ctx, rowId, done, org.stage, template, opts.auditAs, report),
    );
    ledger = done;
    return result("done", { report, facts, previewHost });
  } catch (err) {
    const code: string =
      err instanceof AssemblyFail || err instanceof AssemblyStepError
        ? err.code
        : "UNEXPECTED"; // never reuse a step's code for an unguarded error (WR-A04)
    const page =
      err instanceof AssemblyFail || err instanceof AssemblyStepError
        ? err.page
        : undefined;
    console.error(`[assembly] ${code}`);
    if (!dryRun) {
      ledger = {
        ...ledger,
        status: "failed",
        error: page ? { code, page } : { code },
      };
      try {
        await save();
      } catch {
        console.error("[assembly] LEDGER_WRITE_FAILED");
      }
    }
    return result("failed", { errorCode: code, facts, previewHost });
  }
}

/** Ledger done + stage + audit row in one batch (A2-Q5, T-08-16-06). */
async function finish(
  ctx: OrgContext,
  rowId: string,
  ledger: AssemblyLedger,
  stage: string,
  template: SiteTemplate,
  auditAs: AssemblyOptions["auditAs"],
  report: AssemblyReport,
): Promise<void> {
  await pbRun(async (pb) => {
    // The row must still be this org's own (bound filter, invariant 1).
    const own = await pb.collection("org_intake").getList(1, 1, {
      filter: pb.filter("organization = {:org} && id = {:id}", {
        org: ctx.orgId,
        id: rowId,
      }),
      fields: "id",
    });
    if (!own.items[0]) throw new AssemblyFail("FINISH_FAILED");
    const batch = pb.createBatch();
    batch.collection("org_intake").update(rowId, { assembly: ledger });
    if (stage === "ready_for_build") {
      batch
        .collection("organizations")
        .update(ctx.orgId, { stage: "being_built" });
    }
    const event = {
      action: "site.assembled",
      organization: ctx.orgId,
      targetCollection: "organizations",
      targetId: ctx.orgId,
      meta: {
        job: "assembly",
        template_id: template.id,
        template_version: template.version,
        pages: report.pages.map((p) => `${p.key}:${p.outcome}`),
      },
    };
    batch
      .collection("audit_log")
      .create(
        auditAs === "system"
          ? auditBody(mintSystemContext({ job: "assembly" }), event)
          : auditBody(ctx, event),
      );
    await batch.send();
  });
}

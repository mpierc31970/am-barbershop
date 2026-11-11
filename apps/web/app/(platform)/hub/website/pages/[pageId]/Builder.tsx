"use client";
// Page builder client (CONT-05..08, CONT-30; D183, D119, D254, D-UI-5, D-UI-10;
// 03-UI-SPEC "Page builder", "Interaction states", "Destructive actions"; CONTEXT A2-Q1,
// A2-Q3, A2-Q4).
//
// Focal point: the block being edited (selected row + its form). The header's status line
// and the one accent-filled Publish button are secondary. Two panes at 1024px and up (360px
// block list on hub-surface-2, form pane max 720px), one pane at a time below with an
// "All blocks" back link. Selection is in the URL (?block=<id> / ?add=1) via
// router.replace, so refresh and back work. Every draft change flips the header to
// "Draft saved · Unpublished changes"; publishing is the only thing that goes live.
// Server Actions take ids and content only; the tenant comes from the session cookie.
// P5: add-on block forms come from the registry's admin entry and are injected into the
// shared SectionForm (renderAddonForm); the picker lists active add-ons' blocks and rows of
// an add-on that is off show "Add-on off" (05-UI-SPEC "Builder integration").
// 10-41 (D-UI-P10-26): BuilderPlanProvider gives the editors builderPro + canBuy (server-computed).
// 07-24 (choices 8, 10): BuilderBusinessProvider (inside 07-18's FormOptionsProvider) feeds
// the Map, Hours and Social editors; the picker's presets get the address, phone and
// business type; a multi-block preset inserts its further blocks one after another.
// 07-30 (CONT-14, CONT-35; D188): the header's ghost SEO & sharing button (badge "N to check")
// opens the SeoDrawer (?seo=1). The checklist is core pageChecklist over the current draft
// blocks and page SEO; photo descriptions come from one fetchMediaSource.items lookup of the
// blocks' media, refreshed whenever the blocks change. It never blocks Publish.
// 11-48 (DASH-17, D208): first-use tour `builder` (Add block, blocks, History, Publish),
// mounted from the `tour` prop (null under impersonation).
// 11-25 (DASH-07, D184, D254; 11-UI-SPEC "Page history"): ghost sm History before Preview
// page opens the HistoryDrawer (part "page"): the last 10 published versions, who published
// each, Current on the live one. Restore asks first (Keep current focused), publishes the old
// blocks as a new current version and swaps the restored draft in. Viewers get the list only.
// 12-17 (COMM-11, D102; UI-SPEC "Locks and held changes"): `lock` (server: the page's service
// window and this person's held changes). EditorLockPanel shows the LockedPanel under the
// header, then the HeldChangesPanel after the window. While locked, or while held changes wait, the block
// list and the form pane sit in a LockedFieldset (disabled, not hidden, described by the
// panel), Publish is aria-disabled and History is read only; Preview, History, SEO and the
// Pages link keep working. A block save refused with target_locked is parked through
// holdDraftAction and the editor flips read-only with HELD-KEPT at once. The route remounts
// the builder only when the held set changes (editorLockKey, WR-C05), so Apply / Discard
// come back as fresh server state; a lock starting or ending flips it in place (edits kept).
import { ADDON_REGISTRY, ADDON_SECTIONS } from "@cds/addon-registry";
import { addonBlockForm } from "@cds/addon-registry/admin";
import { headingOwnerId, type PublishedSection } from "@cds/core/content";
import {
  pageChecklist,
  type ChecklistTheme,
  type FixTarget,
  type SeoSection,
} from "@cds/core/seo";
import type { PageSummary, SectionRow } from "@cds/core/content";
import {
  BlockTemplatePicker,
  BuilderBusinessProvider,
  BuilderPlanProvider,
  ERR_PUBLISH_COPY,
  HELD_LINE,
  SectionForm,
  SectionsList,
  blockLabel,
  headerState,
  renderableSections,
  type AddonBlockOption,
  type BlockChoice,
  type BuilderBusiness,
  type BuilderSaveInput,
  type SectionFormAddon,
  useBrowserTimeZone,
} from "@cds/ui/builder";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  FormOptionsProvider,
  HistoryDrawer,
  HISTORY_COPY,
  IconButton,
  InlineAlert,
  LOCKED_CODE,
  buttonClasses,
  fetchMediaSource,
  useToast,
  type AddonBlockFormProps,
} from "@cds/ui/hub";
import {
  ChevronLeft,
  Eye,
  History as HistoryIcon,
  Plus,
  ScanSearch,
  Settings2,
} from "lucide-react";
import { ScreenHelp } from "@cds/ui/hub/shell";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createFormAction } from "../../../../../actions/forms";
import { holdDraftAction } from "../../../../../actions/held-drafts";
import {
  listPageVersionsAction,
  restorePageVersionAction,
} from "../../../../../actions/history";
import { publishPageAction } from "../../../../../actions/publish";
import {
  deleteSectionAction,
  reorderSectionsAction,
  saveSectionAction,
  setSectionHiddenAction,
  undoDeleteSectionAction,
} from "../../../../../actions/sections";
import { callAction } from "../../../../../../lib/call-action";
import {
  NO_LOCK,
  editorReadOnly,
  type EditorLockState,
} from "../../../../../../lib/editor-lock-shared";
import { EditorLockPanel, LockedFieldset } from "../../EditorLock";
import { SECTION_REGISTRY } from "../../../../../../lib/section-registry";
import { useRegisterNavGuard } from "../../../nav-guard";
import { TourHost } from "../../../TourHost";
import { publishLooksDisabled, publishStep } from "./publish-step";
import { SEO_COPY, SeoDrawer, seoBadgeLabel } from "./SeoDrawer";
import { PAGE_SETTINGS_COPY, PageSettingsDrawer } from "./PageSettingsDrawer";

const PAGES_HREF = "/hub/website";
const SEO_LEAVE_COPY =
  "You changed the title, description, address or share image but haven't saved them.";

export interface BuilderProps {
  page: PageSummary;
  sections: SectionRow[];
  popups: { id: string; name: string; deleted?: boolean }[];
  /** 07-28: section id -> "Uses a deleted …" row label (server-computed). */
  deletedRefLabels?: Readonly<Record<string, string>>;
  primaryHost: string | null;
  initialBlockId: string | null;
  initialAdding: boolean;
  /** The org's resolved theme, read on the server; paints the Background swatches. */
  theme: { hash: string; css: string };
  /** Active add-on slugs (read on the server with the session context). */
  activeAddons?: readonly string[];
  /** 10-32: add-on slugs paused by a billing lapse (their blocks say "Paused"). */
  pausedAddons?: readonly string[];
  /** The active add-ons' block types for the picker ("From your add-ons"). */
  addonBlocks?: readonly AddonBlockOption[];
  /** The site's forms (deleted ones flagged) for every Form item editor (07-18 choice 3). */
  forms?: readonly { id: string; name: string; deleted?: boolean }[];
  /** 07-24: the org's business details for the data-bound editors and presets. */
  business?: BuilderBusiness | null;
  /** 07-30: the site menu (the "in your menu" check). */
  nav?: unknown;
  /** 07-30: the business name for the title suggestion. */
  businessName?: string;
  /** 07-30: preview of the site share image (used when the page has none). */
  siteSharePreview?: string | null;
  /** 07-30: "builder" or "system-404" (07-32); system pages hide address and share image. */
  pageKind?: string;
  /** 07-30: the theme's colour roles for the contrast check (null = skip it). */
  checklistTheme?: ChecklistTheme | null;
  /** 07-30: open the SEO & sharing drawer on load (?seo=1). */
  initialSeoOpen?: boolean;
  /** 07-32: the page is in the site menu (navHasPage, server). */
  inMenu?: boolean;
  /** 07-32: top-level menu links (NAV-LIMIT in Page settings). */
  navTopCount?: number;
  /** 07-32: open the Page settings drawer on load (?settings=1). */
  initialSettingsOpen?: boolean;
  /** 10-41: the org has builder-pro right now (server getEntitlements; D233). */
  builderPro?: boolean;
  /** 10-41: the member may buy add-ons (can purchases:run); locks show "Add Builder Pro". */
  canBuy?: boolean;
  /** 11-25: the member may restore a page version (can content:write); else read only. */
  canRestore?: boolean;
  /** 11-48 (DASH-17): the builder's first-use tour; null for impersonating staff. */
  tour?: { autoStart: boolean } | null;
  /** 12-17: the page's service-window lock and this person's held changes (server). */
  lock?: EditorLockState;
}

const NO_FORMS: readonly { id: string; name: string; deleted?: boolean }[] = [];
const NO_ADDONS: readonly string[] = [];
const NO_BLOCKS: readonly AddonBlockOption[] = [];

/** The add-on owning a block type, with whether it is on for this org. */
function addonOf(
  type: string,
  active: ReadonlySet<string>,
): SectionFormAddon | null {
  const slug = ADDON_REGISTRY.ownerOf(type);
  if (!slug) return null;
  const name = ADDON_REGISTRY.get(slug)?.name ?? slug;
  return { slug, name, active: active.has(slug) };
}

/** The registry's block form for an add-on type (own-property lookup inside). */
function renderAddonForm(type: string, props: AddonBlockFormProps) {
  const Form = addonBlockForm(type);
  return Form ? <Form {...props} /> : null;
}

function pagePath(slug: string): string {
  return slug === "home" ? "/" : `/${slug}`;
}

type ItemLike = { kind?: unknown; form_id?: unknown };

function columnItems(choice: BlockChoice): ItemLike[] {
  if (choice.section_type !== "columns") return [];
  const cols = (choice.content as { columns?: unknown })?.columns;
  if (!Array.isArray(cols)) return [];
  return cols.flatMap((c) => {
    const items = (c as { items?: unknown })?.items;
    return Array.isArray(items) ? (items as ItemLike[]) : [];
  });
}

/** A preset columns block with a Form item that names no form yet (07-24). */
function needsForm(choice: BlockChoice): boolean {
  return columnItems(choice).some((i) => i.kind === "form" && i.form_id === "");
}

/** The same block with every unnamed Form item pointing at `formId`. */
function withFormId(choice: BlockChoice, formId: string): BlockChoice {
  if (!needsForm(choice)) return choice;
  const content = choice.content as {
    columns: { items: ItemLike[] }[];
  };
  return {
    ...choice,
    content: {
      ...content,
      columns: content.columns.map((c) => ({
        ...c,
        items: c.items.map((i) =>
          i.kind === "form" && i.form_id === "" ? { ...i, form_id: formId } : i,
        ),
      })),
    },
  };
}

/** A live form for the Contact preset: one named like "contact" first, else the first. */
function presetFormId(
  forms: readonly { id: string; name: string; deleted?: boolean }[],
): string {
  const live = forms.filter((f) => !f.deleted);
  return (live.find((f) => /contact/i.test(f.name)) ?? live[0])?.id ?? "";
}

function sortRows(rows: readonly SectionRow[]): SectionRow[] {
  return [...rows].sort((a, b) => a.sort_order - b.sort_order);
}

export function Builder({
  page: initialPage,
  sections: initialSections,
  popups,
  deletedRefLabels,
  primaryHost,
  initialBlockId,
  initialAdding,
  theme,
  activeAddons = NO_ADDONS,
  pausedAddons = NO_ADDONS,
  addonBlocks = NO_BLOCKS,
  forms = NO_FORMS,
  business = null,
  nav = null,
  businessName = "",
  siteSharePreview = null,
  pageKind = "builder",
  checklistTheme = null,
  initialSeoOpen = false,
  inMenu: initialInMenu = false,
  navTopCount = 0,
  initialSettingsOpen = false,
  builderPro = false,
  canBuy = false,
  canRestore = false,
  tour = null,
  lock = NO_LOCK,
}: BuilderProps) {
  const builderPlan = useMemo(
    () => ({ builderPro, canBuy }),
    [builderPro, canBuy],
  );
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const toast = useToast();
  const disabledTipId = useId();
  const lockPanelId = useId();
  // 12-17: a save refused by the lock parks here until the route re-renders with it.
  const [parked, setParked] = useState<EditorLockState | null>(null);
  const lockState = parked ?? lock;
  const readOnly = editorReadOnly(lockState);
  // The owner's browser zone, like pop-ups and the banner (03-UI-REVIEW Fix 1).
  const timeZone = useBrowserTimeZone();

  const [page, setPageState] = useState(initialPage);
  // The page as of the latest update, for publish() continuations that run from a stale
  // render (after "Save and continue"): they must see the save's has_unpublished_changes
  // (WR-B04). Every page update goes through setPage, so the ref never lags.
  const pageRef = useRef(initialPage);
  function setPage(update: (p: PageSummary) => PageSummary) {
    pageRef.current = update(pageRef.current);
    setPageState(pageRef.current);
  }
  const [sections, setSections] = useState<SectionRow[]>(() =>
    sortRows(initialSections),
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    initialBlockId && initialSections.some((s) => s.id === initialBlockId)
      ? initialBlockId
      : null,
  );
  const [adding, setAdding] = useState(initialAdding);
  const [creating, setCreating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [pendingNav, setPendingNav] = useState<{ run: () => void } | null>(
    null,
  );
  const [guardSaving, setGuardSaving] = useState(false);
  // Bumped by "Discard changes" to remount the block form from the last saved row, so the
  // form never keeps showing edits the owner just discarded (WR-B03).
  const [formEpoch, setFormEpoch] = useState(0);
  const dirtyRef = useRef(false);
  // The same flag as state, so the Publish button re-renders enabled while edits are open.
  const [formDirty, setFormDirty] = useState(false);
  const saveRef = useRef<(() => Promise<boolean>) | null>(null);

  // The header's real height, so the sticky list pane starts right under it even when a
  // long status line wraps (03-UI-REVIEW Fix 2). 64px (4rem) until measured.
  const rootRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    const head = headerRef.current;
    if (!root || !head || typeof ResizeObserver === "undefined") return;
    const sync = () =>
      root.style.setProperty(
        "--builder-header-h",
        `${head.getBoundingClientRect().height}px`,
      );
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(head);
    return () => ro.disconnect();
  }, []);

  // ---------------------------------------------------------------------------
  // 07-30: SEO & sharing
  // ---------------------------------------------------------------------------
  const [seoOpen, setSeoOpen] = useState(initialSeoOpen);
  // 11-25: page history drawer.
  const [historyOpen, setHistoryOpen] = useState(false);
  // 07-32: Page settings (password + menu). System pages have none.
  const isSystemPage = pageKind === "system-404";
  const [settingsOpen, setSettingsOpen] = useState(
    initialSettingsOpen && !isSystemPage,
  );
  const settingsDirtyRef = useRef(false);
  const [settingsLeave, setSettingsLeave] = useState<{
    run: () => void;
  } | null>(null);
  const [settingsEpoch, setSettingsEpoch] = useState(0);
  const [inMenu, setInMenu] = useState(initialInMenu);
  const seoDirtyRef = useRef(false);
  const [seoLeave, setSeoLeave] = useState<{ run: () => void } | null>(null);
  // Bumped by the leave dialog's Discard to remount the drawer from the saved page.
  const [seoEpoch, setSeoEpoch] = useState(0);
  const [needsDescription, setNeedsDescription] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const mediaIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of sections) {
      try {
        const def = SECTION_REGISTRY.get(s.section_type);
        for (const id of def?.refsOf(s.content).media ?? []) ids.add(id);
      } catch {
        // A malformed block names no media.
      }
    }
    return [...ids].slice(0, 60);
  }, [sections]);
  useEffect(() => {
    if (mediaIds.length === 0) {
      setNeedsDescription(new Set());
      return;
    }
    let live = true;
    void fetchMediaSource.items(mediaIds).then((res) => {
      if (!live || !res.ok) return;
      setNeedsDescription(
        new Set(res.data.filter((i) => i.needsDescription).map((i) => i.id)),
      );
    });
    return () => {
      live = false;
    };
  }, [mediaIds]);
  const seoSections = useMemo<SeoSection[]>(
    () =>
      sections.map((s) => ({
        id: s.id,
        section_type: s.section_type,
        content: s.content,
        hidden: !s.is_published,
        settings: s.settings,
      })),
    [sections],
  );
  const checklist = useMemo(
    () =>
      pageChecklist(
        {
          pageId: page.id,
          isHome: page.slug === "home",
          pageKind,
          title: page.title,
          seo: page.seo,
          sections: seoSections,
        },
        {
          businessName,
          nav,
          theme: checklistTheme,
          mediaNeedsDescription: needsDescription,
          blockLabel: (t) => blockLabel(t, SECTION_REGISTRY),
        },
      ),
    [
      page,
      pageKind,
      seoSections,
      businessName,
      nav,
      checklistTheme,
      needsDescription,
    ],
  );
  const seoBadge = seoBadgeLabel(checklist);

  const selected = sections.find((s) => s.id === selectedId) ?? null;
  const selectedLabel = selected
    ? blockLabel(selected.section_type, SECTION_REGISTRY)
    : "";
  const header = headerState(page, { publishing, timeZone });
  const liveUrl = primaryHost
    ? `https://${primaryHost}${pagePath(page.slug)}`
    : null;
  const previewHref = `${pathname.replace(/\/$/, "")}/preview`;

  const activeSet = useMemo(() => new Set(activeAddons), [activeAddons]);
  // Add-on block types split by whether their add-on is on (active types draw on the site).
  const { onTypes, offTypes } = useMemo(() => {
    const on = new Set<string>();
    const off = new Set<string>();
    for (const d of ADDON_SECTIONS) {
      const slug = ADDON_REGISTRY.ownerOf(d.type);
      if (slug && activeSet.has(slug)) on.add(d.type);
      else off.add(d.type);
    }
    return { onTypes: on, offTypes: off };
  }, [activeSet]);
  // 10-32: off block types whose add-on is paused by a billing lapse -> add-on name.
  const pausedTypes = useMemo(() => {
    const paused = new Set(pausedAddons);
    const out: Record<string, string> = {};
    for (const d of ADDON_SECTIONS) {
      const slug = ADDON_REGISTRY.ownerOf(d.type);
      if (!slug || activeSet.has(slug) || !paused.has(slug)) continue;
      out[d.type] = ADDON_REGISTRY.get(slug)?.name ?? slug;
    }
    return out;
  }, [activeSet, pausedAddons]);

  // The block that owns the page h1: the first visible heading-bearing block that the
  // site actually draws (D-UI-11; same helper as PageRenderer, WR-C08). Active add-on
  // blocks count; an add-on block with no live data gives it up on the site (Pitfall 9).
  const h1OwnerId = useMemo(
    () =>
      headingOwnerId(
        renderableSections(
          sections.filter((s) => s.is_published),
          SECTION_REGISTRY,
          { extraTypes: onTypes },
        ) as unknown as PublishedSection[],
        SECTION_REGISTRY,
      ),
    [sections, onTypes],
  );

  // -------------------------------------------------------------------------
  // Selection, URL and the leave guard
  // -------------------------------------------------------------------------

  function setUrl(block: string | null, add: boolean) {
    const q = add
      ? "?add=1"
      : block
        ? `?block=${encodeURIComponent(block)}`
        : "";
    router.replace(`${pathname}${q}`, { scroll: false });
  }

  /** Run `go` now, or after the owner answers the leave-guard dialog. */
  function guard(go: () => void) {
    if (dirtyRef.current) setPendingNav({ run: go });
    else go();
  }

  function openSeo() {
    setSeoOpen(true);
    router.replace(`${pathname}?seo=1`, { scroll: false });
  }

  function closeSeo() {
    setSeoOpen(false);
    setUrl(adding ? null : selectedId, adding);
  }

  function openSettings() {
    setSettingsOpen(true);
    router.replace(`${pathname}?settings=1`, { scroll: false });
  }

  function closeSettings() {
    const go = () => {
      setSettingsOpen(false);
      setUrl(adding ? null : selectedId, adding);
    };
    if (settingsDirtyRef.current) setSettingsLeave({ run: go });
    else go();
  }

  /** A checklist Fix that leaves the drawer: select the block (and its item) or navigate. */
  function onSeoFix(target: FixTarget) {
    if (target.kind === "href") {
      const href = target.href;
      const go = () => guard(() => router.push(href));
      if (seoDirtyRef.current) setSeoLeave({ run: go });
      else go();
      return;
    }
    if (target.kind !== "block") return;
    setSeoOpen(false);
    guard(() => {
      setSelectedId(target.sectionId);
      setAdding(false);
      setUrl(target.sectionId, false);
      const itemId = target.itemId;
      setTimeout(() => {
        const item = itemId
          ? document.querySelector<HTMLElement>(
              `[data-item-id="${CSS.escape(itemId)}"]`,
            )
          : null;
        const focusable =
          item?.querySelector<HTMLElement>("button[aria-controls]") ??
          document.querySelector<HTMLElement>(
            "[data-builder-detail] h2, [data-builder-detail] h3",
          );
        if (focusable) {
          if (
            !focusable.hasAttribute("tabindex") &&
            focusable.tagName === "H2"
          ) {
            focusable.setAttribute("tabindex", "-1");
          }
          focusable.scrollIntoView?.({ block: "center" });
          focusable.focus();
        }
      }, 50);
    });
  }

  // Hub chrome (sidebar links, Sign out) asks before it leaves a dirty form (WR-B05).
  useRegisterNavGuard((go) => {
    if (!dirtyRef.current && settingsDirtyRef.current) {
      setSettingsLeave({ run: go });
      return true;
    }
    if (!dirtyRef.current && seoDirtyRef.current) {
      setSeoLeave({ run: go });
      return true;
    }
    if (!dirtyRef.current) return false;
    setPendingNav({ run: go });
    return true;
  });

  function select(id: string) {
    if (id === selectedId && !adding) return;
    guard(() => {
      setSelectedId(id);
      setAdding(false);
      setUrl(id, false);
    });
  }

  function startAdd() {
    guard(() => {
      setAdding(true);
      setUrl(null, true);
    });
  }

  function showList() {
    guard(() => {
      setSelectedId(null);
      setAdding(false);
      setUrl(null, false);
    });
  }

  function markChanged() {
    setPage((p) => ({ ...p, has_unpublished_changes: true }));
    setPublishError(null);
  }

  // -------------------------------------------------------------------------
  // Block actions. Every action goes through callAction, so a rejected request is a
  // failed result and each handler reverts and says so (WR-B02).
  // -------------------------------------------------------------------------

  async function onReorder(ids: string[]): Promise<boolean> {
    const res = await callAction(() => reorderSectionsAction(page.id, ids));
    if (!res.ok) return false;
    setSections((rows) => {
      const byId = new Map(rows.map((r) => [r.id, r]));
      return ids.flatMap((id, i) => {
        const r = byId.get(id);
        return r ? [{ ...r, sort_order: i + 1 }] : [];
      });
    });
    markChanged();
    return true;
  }

  async function onToggleHidden(id: string, hidden: boolean) {
    const set = (published: boolean) =>
      setSections((rows) =>
        rows.map((r) => (r.id === id ? { ...r, is_published: published } : r)),
      );
    set(!hidden);
    const res = await callAction(() => setSectionHiddenAction(id, hidden));
    if (!res.ok) {
      set(hidden);
      toast.show({ message: res.message });
      return;
    }
    markChanged();
  }

  async function onDelete(id: string) {
    const index = sections.findIndex((s) => s.id === id);
    const row = sections[index];
    if (!row) return;
    const label = blockLabel(row.section_type, SECTION_REGISTRY);
    const res = await callAction(() => deleteSectionAction(id));
    if (!res.ok) {
      toast.show({ message: res.message });
      return;
    }
    const snapshot = res.data;
    setSections((rows) => rows.filter((r) => r.id !== id));
    if (selectedId === id) {
      dirtyRef.current = false;
      setFormDirty(false);
      setSelectedId(null);
      setUrl(null, false);
    }
    markChanged();
    toast.show({
      message: `${label} block deleted.`,
      action: {
        label: "Undo",
        onClick: () => {
          void callAction(() => undoDeleteSectionAction(snapshot)).then(
            (undo) => {
              if (!undo.ok) {
                toast.show({ message: undo.message });
                return;
              }
              setSections((rows) => {
                const next = [...rows];
                next.splice(Math.min(index, next.length), 0, undo.data);
                return next.map((r, i) => ({ ...r, sort_order: i + 1 }));
              });
              markChanged();
            },
          );
        },
      },
    });
  }

  /** Save one new block after `afterId` (or at the end) and splice it into local state. */
  async function insertBlock(
    choice: BlockChoice,
    afterId: string | undefined,
  ): Promise<SectionRow | null> {
    const res = await callAction(() =>
      saveSectionAction({
        pageId: page.id,
        section_type: choice.section_type,
        row_layout: choice.row_layout,
        content: choice.content,
        settings: { background_variant: "main" },
        ...(afterId ? { afterId } : {}),
      }),
    );
    if (!res.ok) {
      toast.show({ message: res.message });
      return null;
    }
    const created = res.data;
    setSections((rows) => {
      const at = afterId
        ? rows.findIndex((r) => r.id === afterId) + 1
        : rows.length;
      const next = [...rows];
      next.splice(at > 0 ? at : rows.length, 0, created);
      return next.map((r, i) => ({ ...r, sort_order: i + 1 }));
    });
    return created;
  }

  async function onPick(choice: BlockChoice, more?: readonly BlockChoice[]) {
    setCreating(true);
    try {
      // 07-24: the Contact form and map preset needs a form to save its Form item; with no
      // live form on the site, create one from the contact template first.
      const blocks = [choice, ...(more ?? [])];
      if (blocks.some(needsForm)) {
        const res = await callAction(() =>
          createFormAction({ template: "contact" }),
        );
        if (!res.ok) {
          toast.show({ message: res.message });
          return;
        }
        for (let i = 0; i < blocks.length; i++) {
          blocks[i] = withFormId(blocks[i]!, res.data.id);
        }
        router.refresh();
      }
      const [first, ...rest] = blocks;
      choice = first!;
      more = rest;
      const created = await insertBlock(choice, selectedId ?? undefined);
      if (!created) return;
      // 07-24: a multi-block preset inserts the rest in order, each after the one before;
      // a later failure toasts and keeps what was created.
      let previous = created.id;
      for (const next of more ?? []) {
        const row = await insertBlock(next, previous);
        if (!row) break;
        previous = row.id;
      }
      setSelectedId(created.id);
      setAdding(false);
      setUrl(created.id, false);
      markChanged();
    } finally {
      setCreating(false);
    }
  }

  async function onSave(input: BuilderSaveInput) {
    const res = await callAction(() => saveSectionAction(input));
    if (!res.ok && res.code === LOCKED_CODE) {
      // 12-17: CDS locked the page mid-edit. Keep the change as a held draft and go
      // read-only with HELD-KEPT (no dialog, no toast: the panel is the message).
      const hold = await callAction(() =>
        holdDraftAction("section", input.pageId, input),
      );
      if (hold.ok) {
        dirtyRef.current = false;
        setFormDirty(false);
        setParked(hold.data.lock);
      }
      return res;
    }
    if (res.ok) {
      const saved = res.data;
      setSections((rows) => rows.map((r) => (r.id === saved.id ? saved : r)));
      markChanged();
    }
    return res;
  }

  // -------------------------------------------------------------------------
  // Publish
  // -------------------------------------------------------------------------

  async function publish() {
    if (readOnly) return;
    // Unsaved edits first, then "no changes", from refs (WR-B04).
    const step = publishStep({
      publishing,
      formDirty: dirtyRef.current,
      page: pageRef.current,
    });
    if (step === "guard") {
      guard(() => void publish());
      return;
    }
    if (step !== "publish") return;
    setPublishing(true);
    setPublishError(null);
    try {
      const res = await publishPageAction(page.id);
      if (!res.ok) {
        setPublishError(res.message || ERR_PUBLISH_COPY);
        return;
      }
      if (res.data.status === "held") {
        setPage((p) => ({ ...p, status: "held" }));
        toast.show({ message: HELD_LINE });
        return;
      }
      const at = res.data.published_at;
      setPage((p) => ({
        ...p,
        status: "published",
        published_at: at,
        has_unpublished_changes: false,
      }));
      toast.show({
        message: "Published. Your changes are live.",
        ...(liveUrl
          ? {
              action: {
                label: "View page",
                onClick: () => window.open(liveUrl, "_blank", "noopener"),
              },
              durationMs: 6000,
            }
          : {}),
      });
    } catch {
      setPublishError(ERR_PUBLISH_COPY);
    } finally {
      setPublishing(false);
    }
  }

  /** 11-25: restore a version (it publishes) and swap the restored draft in. */
  async function restoreVersion(version: string) {
    const res = await callAction(() =>
      restorePageVersionAction(page.id, version),
    );
    if (!res.ok) return res;
    const restored = res.data;
    pageRef.current = restored.page;
    setPageState(restored.page);
    setSections(sortRows(restored.sections));
    dirtyRef.current = false;
    setFormDirty(false);
    setFormEpoch((n) => n + 1);
    setAdding(false);
    setSelectedId(null);
    setUrl(null, false);
    return {
      ok: true as const,
      data: { at: restored.at, dropped: restored.dropped, held: restored.held },
    };
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const detailOpen = adding || selected !== null;

  let detail;
  if (adding) {
    detail = (
      <BlockTemplatePicker
        busy={creating}
        addonBlocks={addonBlocks}
        registry={SECTION_REGISTRY}
        hasHero={sections.some((s) => s.section_type === "hero")}
        presetContext={{
          addressText: business?.addressText ?? "",
          phone: business?.phone ?? "",
          email: business?.email ?? "",
          businessType: business?.businessType ?? "",
          formId: presetFormId(forms),
        }}
        onPick={(c, more) => void onPick(c, more)}
        onExit={() => {
          setAdding(false);
          setUrl(selectedId, false);
        }}
      />
    );
  } else if (selected) {
    detail = (
      <SectionForm
        key={`${selected.id}:${formEpoch}`}
        section={selected}
        theme={theme}
        popups={popups}
        registry={SECTION_REGISTRY}
        timeZone={timeZone}
        saveRef={saveRef}
        onSave={onSave}
        onDirtyChange={(d) => {
          dirtyRef.current = d;
          setFormDirty(d);
        }}
        onToggleHidden={(hidden) => void onToggleHidden(selected.id, hidden)}
        addon={addonOf(selected.section_type, activeSet)}
        renderAddonForm={renderAddonForm}
        onDelete={() => void onDelete(selected.id)}
      />
    );
  } else if (sections.length === 0) {
    detail = (
      <EmptyState
        heading="This page is empty"
        body="Add a block to start building it. A Hero works well at the top of a page."
        action={
          <Button
            variant="primary"
            icon={<Plus aria-hidden size={16} strokeWidth={2} />}
            onClick={startAdd}
          >
            Add block
          </Button>
        }
      />
    );
  } else {
    detail = (
      <p className="text-base text-hub-ink-muted">
        Choose a block to edit it, or add a new one.
      </p>
    );
  }

  const publishDisabled =
    readOnly || publishLooksDisabled(header.publishDisabled, formDirty);
  const disabledReason =
    readOnly || formDirty ? undefined : header.disabledReason;
  const publishDescribedBy = readOnly
    ? lockPanelId
    : disabledReason
      ? disabledTipId
      : undefined;

  const publishButton = (
    <span
      className="group/publish relative inline-flex w-full md:w-auto"
      data-tour="builder-publish"
    >
      <Button
        variant="primary"
        loading={header.publishing}
        loadingLabel="Publishing…"
        aria-disabled={publishDisabled || undefined}
        aria-describedby={publishDescribedBy}
        onClick={() => void publish()}
        className={
          "w-full md:w-auto" +
          (publishDisabled && !header.publishing
            ? " cursor-not-allowed opacity-50 hover:bg-hub-accent"
            : "")
        }
      >
        {header.publishLabel}
      </Button>
      {disabledReason && !header.publishing ? (
        <span
          id={disabledTipId}
          role="tooltip"
          className={
            "pointer-events-none absolute top-full right-0 z-20 mt-1 rounded bg-hub-ink px-2 py-1 " +
            "text-sm whitespace-nowrap text-hub-surface opacity-0 transition-opacity duration-150 " +
            "group-hover/publish:opacity-100 group-focus-within/publish:opacity-100"
          }
        >
          {disabledReason}
        </span>
      ) : null}
    </span>
  );

  return (
    <FormOptionsProvider forms={forms} createForm={createFormAction}>
      <BuilderBusinessProvider value={business}>
        <BuilderPlanProvider value={builderPlan}>
          <div
            ref={rootRef}
            className="flex min-h-dvh flex-col font-hub text-hub-ink"
          >
            {/* The hub's 56px top bar stays pinned at top-0 at every width (11-16, D-UI-P11-2),
          so this one pins under it (top-14). It is the bar the list pane's sticky offset
          reads from --builder-header-h, plus the top bar (03-UI-REVIEW Fix 2). */}
            <header
              ref={headerRef}
              className="sticky top-14 z-20 flex flex-col gap-2 border-b border-hub-border bg-hub-surface px-4 py-2 md:min-h-16 md:flex-row md:items-center md:justify-between md:gap-6 md:px-8"
            >
              <div className="flex min-w-0 flex-col gap-1 lg:flex-row lg:items-center lg:gap-4">
                <Link
                  href={PAGES_HREF}
                  onClick={(e) => {
                    if (!dirtyRef.current) return;
                    e.preventDefault();
                    guard(() => router.push(PAGES_HREF));
                  }}
                  className="inline-flex w-fit items-center gap-1 rounded text-sm font-semibold text-hub-ink-muted hover:text-hub-ink"
                >
                  <ChevronLeft aria-hidden size={16} strokeWidth={2} />
                  Pages
                </Link>
                {isSystemPage ? (
                  <span
                    className="text-sm font-semibold text-hub-ink-muted"
                    data-system-page-label=""
                  >
                    Page not found
                  </span>
                ) : null}
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
                  <div className="flex min-w-0 items-center gap-1">
                    <h1 className="truncate text-[1.75rem] leading-tight font-semibold">
                      {page.title}
                    </h1>
                    {/* 11-47 (DASH-17, 11-UI-SPEC): the builder's one "?" sits beside the
                        page title and opens the Pages how-to in the help drawer. */}
                    <ScreenHelp
                      helpId="website.pages"
                      name="the page builder"
                    />
                  </div>
                  <span className="text-sm text-hub-ink-muted">
                    {pagePath(page.slug)}
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm text-hub-ink-muted tabular-nums">
                    {header.statusLine}
                  </p>
                  {header.badge ? (
                    <Badge tone={header.badge.tone}>{header.badge.label}</Badge>
                  ) : null}
                  {!isSystemPage && page.password_protected ? (
                    <Badge tone="password">Password</Badge>
                  ) : null}
                </div>
                <div className="flex flex-col gap-2 md:flex-row">
                  <Button
                    variant="ghost"
                    icon={<ScanSearch aria-hidden size={16} strokeWidth={2} />}
                    onClick={openSeo}
                    aria-haspopup="dialog"
                    className="w-full md:w-auto"
                    data-seo-button=""
                  >
                    {SEO_COPY.title}
                    {seoBadge ? (
                      <Badge tone="to-check">{seoBadge}</Badge>
                    ) : null}
                  </Button>
                  {isSystemPage ? null : (
                    <IconButton
                      label={PAGE_SETTINGS_COPY.title}
                      icon={<Settings2 aria-hidden size={16} strokeWidth={2} />}
                      onClick={openSettings}
                      aria-haspopup="dialog"
                      className="w-full md:w-auto"
                      data-page-settings-button=""
                    />
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<HistoryIcon aria-hidden size={16} strokeWidth={2} />}
                    onClick={() => setHistoryOpen(true)}
                    aria-haspopup="dialog"
                    className="w-full md:w-auto"
                    data-tour="builder-history"
                  >
                    {HISTORY_COPY.button}
                  </Button>
                  <Link
                    href={previewHref}
                    onClick={(e) => {
                      if (!dirtyRef.current) return;
                      e.preventDefault();
                      guard(() => router.push(previewHref));
                    }}
                    className={`${buttonClasses("secondary")} w-full md:w-auto`}
                  >
                    <Eye aria-hidden size={16} strokeWidth={2} />
                    <span>Preview page</span>
                  </Link>
                  {publishButton}
                </div>
              </div>
            </header>

            <EditorLockPanel
              state={lockState}
              target="page"
              panelId={lockPanelId}
              applies="draft"
              className="mx-4 mt-4 md:mx-8"
            />

            {publishError ? (
              <div className="px-4 pt-4 md:px-8">
                <InlineAlert tone="error">{publishError}</InlineAlert>
              </div>
            ) : null}

            <div className="flex flex-1 flex-col lg:grid lg:grid-cols-[360px_minmax(0,1fr)]">
              <div
                className={
                  "bg-hub-surface-2 lg:sticky lg:top-[calc(var(--builder-header-h,4rem)+3.5rem)] lg:block lg:h-[calc(100dvh-var(--builder-header-h,4rem)-3.5rem)] lg:overflow-y-auto " +
                  (detailOpen ? "hidden" : "block")
                }
              >
                <LockedFieldset readOnly={readOnly} panelId={lockPanelId}>
                  <SectionsList
                    sections={sections}
                    selectedId={adding ? null : selectedId}
                    h1OwnerId={h1OwnerId}
                    registry={SECTION_REGISTRY}
                    offTypes={offTypes}
                    pausedTypes={pausedTypes}
                    deletedRefLabels={deletedRefLabels}
                    onSelect={select}
                    onReorder={onReorder}
                    onToggleHidden={(id, hidden) =>
                      void onToggleHidden(id, hidden)
                    }
                    onDelete={(id) => void onDelete(id)}
                    onAdd={startAdd}
                  />
                </LockedFieldset>
              </div>
              <div
                className={
                  "bg-hub-surface px-4 py-6 md:px-8 md:py-8 lg:block " +
                  (detailOpen ? "block" : "hidden")
                }
              >
                <div
                  className="flex max-w-[720px] flex-col gap-6"
                  data-builder-detail=""
                >
                  {detailOpen ? (
                    <button
                      type="button"
                      onClick={showList}
                      className="inline-flex w-fit items-center gap-1 rounded text-sm font-semibold text-hub-ink-muted hover:text-hub-ink lg:hidden"
                    >
                      <ChevronLeft aria-hidden size={16} strokeWidth={2} />
                      All blocks
                    </button>
                  ) : null}
                  <LockedFieldset readOnly={readOnly} panelId={lockPanelId}>
                    {detail}
                  </LockedFieldset>
                </div>
              </div>
            </div>

            <Dialog
              open={pendingNav !== null}
              onClose={() => setPendingNav(null)}
              title={`Save changes to ${selectedLabel || "this"} block?`}
              footer={
                <>
                  <Button onClick={() => setPendingNav(null)}>
                    Keep editing
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      const go = pendingNav?.run;
                      dirtyRef.current = false;
                      setFormDirty(false);
                      // A real reset: the form remounts from the saved row (WR-B03). Without it a
                      // non-navigating action (publish) leaves the edits on screen with the guard off.
                      setFormEpoch((n) => n + 1);
                      setPendingNav(null);
                      go?.();
                    }}
                  >
                    Discard changes
                  </Button>
                  <Button
                    variant="primary"
                    loading={guardSaving}
                    loadingLabel="Saving…"
                    onClick={async () => {
                      const go = pendingNav?.run;
                      setGuardSaving(true);
                      const ok = (await saveRef.current?.()) ?? false;
                      setGuardSaving(false);
                      setPendingNav(null);
                      if (ok) {
                        dirtyRef.current = false;
                        setFormDirty(false);
                        go?.();
                      }
                    }}
                  >
                    Save and continue
                  </Button>
                </>
              }
            >
              You changed this block but haven&apos;t saved it.
            </Dialog>
            <Dialog
              open={seoLeave !== null}
              onClose={() => setSeoLeave(null)}
              title="Leave without saving your SEO settings?"
              footer={
                <>
                  <Button onClick={() => setSeoLeave(null)}>
                    Keep editing
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      const go = seoLeave?.run;
                      seoDirtyRef.current = false;
                      setSeoEpoch((n) => n + 1);
                      setSeoLeave(null);
                      setSeoOpen(false);
                      go?.();
                    }}
                  >
                    Discard changes
                  </Button>
                </>
              }
            >
              {SEO_LEAVE_COPY}
            </Dialog>
            <Dialog
              open={settingsLeave !== null}
              onClose={() => setSettingsLeave(null)}
              title="Leave without saving your page settings?"
              footer={
                <>
                  <Button onClick={() => setSettingsLeave(null)}>
                    Keep editing
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      const go = settingsLeave?.run;
                      settingsDirtyRef.current = false;
                      setSettingsEpoch((n) => n + 1);
                      setSettingsLeave(null);
                      setSettingsOpen(false);
                      go?.();
                    }}
                  >
                    Discard changes
                  </Button>
                </>
              }
            >
              You changed this page&apos;s settings but haven&apos;t saved them.
            </Dialog>
            {isSystemPage ? null : (
              <PageSettingsDrawer
                key={settingsEpoch}
                open={settingsOpen}
                onClose={closeSettings}
                pageId={page.id}
                passwordProtected={page.password_protected}
                inMenu={inMenu}
                navTopCount={navTopCount}
                pageTitle={page.title}
                pageSlug={page.slug}
                canDelete={canRestore}
                onSaved={(res) => {
                  setPage(() => res.page);
                  setInMenu(res.inMenu);
                }}
                onDirtyChange={(d) => {
                  settingsDirtyRef.current = d;
                }}
              />
            )}
            <HistoryDrawer
              open={historyOpen}
              onClose={() => setHistoryOpen(false)}
              part="page"
              list={() => callAction(() => listPageVersionsAction(page.id))}
              restore={restoreVersion}
              onRestored={() => setHistoryOpen(false)}
              unsavedChanges={formDirty}
              readOnly={!canRestore || readOnly}
              timeZone={timeZone}
            />
            <SeoDrawer
              key={seoEpoch}
              open={seoOpen}
              onClose={closeSeo}
              page={page}
              host={primaryHost}
              businessName={businessName}
              sections={seoSections}
              checklist={checklist}
              siteSharePreview={siteSharePreview}
              hideAddress={pageKind === "system-404"}
              hideShareImage={pageKind === "system-404"}
              onSaved={(saved) => setPage(() => saved)}
              onFix={onSeoFix}
              onDirtyChange={(d) => {
                seoDirtyRef.current = d;
              }}
            />
            {tour ? (
              <TourHost tourId="builder" autoStart={tour.autoStart} />
            ) : null}
          </div>
        </BuilderPlanProvider>
      </BuilderBusinessProvider>
    </FormOptionsProvider>
  );
}

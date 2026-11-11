"use client";
// SEO & sharing drawer in the page builder (07-30; CONT-14, CONT-28, CONT-35; D188, D235 #15,
// D280; 07-UI-SPEC "SEO & sharing drawer").
// Right Drawer 480px. Three sections, 48px apart:
//   1. How it looks in search: SearchResultPreview from the draft, falling back to the live
//      suggestions ("<Page title> | <Business>", the first text block <= 155 chars).
//   2. Details (changes go live on the next publish): Title with a 60 counter and a Use this
//      suggestion; Description (3 rows, 160 counter, same suggestion pattern); Page address
//      with the host prefix and the redirect note after a change (hidden for home and with
//      hideAddress); Share image (library photo or Free photos, 1200x630 frame; empty shows
//      the site share image) hidden with hideShareImage.
//   3. Checks: ChecklistPanel; Fix focuses a field here or hands a block / href target back.
// Footer: Save SEO settings (primary, disabled until dirty) · Discard changes (ghost, when
// dirty). Only changed keys are sent; the action merges them over the page's SEO. It never
// blocks Publish (D188).
import type { PageSummary } from "@cds/core/content";
import {
  SEO_LIMITS,
  suggestDescription,
  suggestTitle,
  type ChecklistItem,
  type FixTarget,
  type SeoSection,
} from "@cds/core/seo";
import { MediaField } from "@cds/ui/builder";
import {
  Button,
  ChecklistPanel,
  Drawer,
  IconButton,
  InlineAlert,
  SearchResultPreview,
  TextArea,
  TextField,
  useToast,
} from "@cds/ui/hub";
import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { saveSeoAction, type SeoInput } from "../../../../../actions/seo";

export const SEO_COPY = Object.freeze({
  title: "SEO & sharing",
  inSearch: "How it looks in search",
  details: "Details",
  detailsNote: "Changes go live when you publish.",
  checks: "Checks",
  titleLabel: "Title in search results",
  descriptionLabel: "Description",
  addressLabel: "Page address",
  shareLabel: "Share image",
  shareEmpty:
    "Uses your site's share image. Choose one for this page if you like.",
  suggested: (s: string) => `Suggested: ${s}`,
  useThis: "Use this",
  redirectNote: (old: string) =>
    `Visitors using /${old} are sent here automatically.`,
  save: "Save SEO settings",
  discard: "Discard changes",
  saved: "SEO settings saved. They go live when you publish.",
  saveFailed:
    "Your changes weren't saved. Try again; if it keeps failing, copy your text somewhere safe first.",
  close: "Close",
});

export const SEO_FIELD_IDS = Object.freeze({
  title: "seo-title",
  description: "seo-description",
  address: "seo-address",
  share: "seo-share-image",
});

type Draft = {
  meta_title: string;
  meta_description: string;
  slug: string;
  share_image: string;
  og_image: string;
  /** The Free photos credit name of a just-picked link (display only). */
  og_credit: string;
};

function draftOf(page: PageSummary): Draft {
  return {
    meta_title: page.seo.meta_title ?? "",
    meta_description: page.seo.meta_description ?? "",
    slug: page.slug,
    share_image: page.seo.share_image ?? "",
    og_image: page.seo.og_image ?? "",
    og_credit: "",
  };
}

/** Only the keys that changed (the action merges them over the stored SEO). */
export function seoChanges(saved: Draft, d: Draft): SeoInput {
  const out: SeoInput = {};
  if (d.meta_title.trim() !== saved.meta_title.trim()) {
    out.meta_title = d.meta_title.trim();
  }
  if (d.meta_description.trim() !== saved.meta_description.trim()) {
    out.meta_description = d.meta_description.trim();
  }
  if (d.share_image !== saved.share_image) out.share_image = d.share_image;
  if (d.og_image !== saved.og_image) out.og_image = d.og_image;
  if (d.slug.trim() !== saved.slug) out.slug = d.slug.trim();
  return out;
}

export interface SeoDrawerProps {
  open: boolean;
  onClose(): void;
  page: PageSummary;
  /** The site's primary host (search preview + address prefix), or null. */
  host: string | null;
  businessName: string;
  sections: readonly SeoSection[];
  checklist: readonly ChecklistItem[];
  /** Preview of the site share image used when the page has none. */
  siteSharePreview: string | null;
  hideAddress?: boolean;
  hideShareImage?: boolean;
  onSaved(page: PageSummary): void;
  /** Block and href targets go back to the builder; field targets are handled here. */
  onFix(target: FixTarget): void;
  onDirtyChange?(dirty: boolean): void;
  /** Test seam. */
  save?: typeof saveSeoAction;
}

function focusField(id: string) {
  requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (el instanceof HTMLElement) {
      el.scrollIntoView?.({ block: "center" });
      el.focus();
    }
  });
}

export function SeoDrawer({
  open,
  onClose,
  page,
  host,
  businessName,
  sections,
  checklist,
  siteSharePreview,
  hideAddress = false,
  hideShareImage = false,
  onSaved,
  onFix,
  onDirtyChange,
  save = saveSeoAction,
}: SeoDrawerProps) {
  const toast = useToast();
  const [saved, setSaved] = useState<Draft>(() => draftOf(page));
  const [draft, setDraft] = useState<Draft>(() => draftOf(page));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slugError, setSlugError] = useState<string | null>(null);

  const isHome = page.slug === "home";
  const changes = seoChanges(saved, draft);
  const dirty = Object.keys(changes).length > 0;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const titleSuggestion = suggestTitle(page.title, businessName, { isHome });
  const descSuggestion = useMemo(
    () => suggestDescription(sections as readonly unknown[]),
    [sections],
  );
  const shownTitle = draft.meta_title.trim() || titleSuggestion;
  const shownDescription = draft.meta_description.trim() || descSuggestion;

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setError(null);
    if (key === "slug") setSlugError(null);
  }

  function fix(target: FixTarget) {
    if (target.kind === "field") {
      focusField(
        target.field === "title"
          ? SEO_FIELD_IDS.title
          : SEO_FIELD_IDS.description,
      );
      return;
    }
    onFix(target);
  }

  async function onSave() {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    const res = await save(page.id, changes).catch(() => null);
    setSaving(false);
    if (!res) {
      setError(SEO_COPY.saveFailed);
      return;
    }
    if (!res.ok) {
      if (
        changes.slug !== undefined &&
        /address|slug/i.test(`${res.code} ${res.message}`)
      ) {
        setSlugError(res.message);
        focusField(SEO_FIELD_IDS.address);
        return;
      }
      setError(res.message);
      return;
    }
    const next = { ...draftOf(res.data.page), og_credit: draft.og_credit };
    setSaved(next);
    setDraft(next);
    onSaved(res.data.page);
    toast.show({ message: SEO_COPY.saved });
  }

  function discard() {
    setDraft(saved);
    setError(null);
    setSlugError(null);
  }

  const hasShare = draft.share_image !== "" || draft.og_image !== "";
  const sectionClass = "flex flex-col gap-4";

  return (
    <Drawer open={open} onClose={onClose} label={SEO_COPY.title} side="right">
      <div className="flex items-center justify-between gap-2 border-b border-hub-border px-6 py-4">
        <h2 className="text-xl leading-tight font-semibold">
          {SEO_COPY.title}
        </h2>
        <IconButton
          label={SEO_COPY.close}
          tooltipAlign="end"
          onClick={onClose}
          icon={<X aria-hidden size={20} strokeWidth={2} />}
        />
      </div>
      <div className="flex flex-1 flex-col gap-12 px-6 py-6" data-seo-drawer="">
        <section aria-labelledby="seo-search-heading" className={sectionClass}>
          <h3 id="seo-search-heading" className="text-xl font-semibold">
            {SEO_COPY.inSearch}
          </h3>
          <SearchResultPreview
            title={shownTitle}
            host={host ?? ""}
            path={isHome ? "" : draft.slug.trim()}
            description={shownDescription}
          />
        </section>

        <section aria-labelledby="seo-details-heading" className={sectionClass}>
          <div className="flex flex-col gap-1">
            <h3 id="seo-details-heading" className="text-xl font-semibold">
              {SEO_COPY.details}
            </h3>
            <p className="text-sm text-hub-ink-muted">{SEO_COPY.detailsNote}</p>
          </div>
          <div className="flex flex-col gap-2">
            <TextField
              id={SEO_FIELD_IDS.title}
              label={SEO_COPY.titleLabel}
              value={draft.meta_title}
              maxLength={200}
              counter={{
                value: draft.meta_title.trim().length,
                max: SEO_LIMITS.title,
              }}
              onChange={(e) => set("meta_title", e.currentTarget.value)}
            />
            {draft.meta_title.trim() === "" && titleSuggestion ? (
              <Suggestion
                text={titleSuggestion}
                onUse={() => set("meta_title", titleSuggestion)}
              />
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <TextArea
              id={SEO_FIELD_IDS.description}
              label={SEO_COPY.descriptionLabel}
              rows={3}
              value={draft.meta_description}
              maxLength={500}
              counter={{
                value: draft.meta_description.trim().length,
                max: SEO_LIMITS.description,
              }}
              onChange={(e) => set("meta_description", e.currentTarget.value)}
            />
            {draft.meta_description.trim() === "" && descSuggestion ? (
              <Suggestion
                text={descSuggestion}
                onUse={() => set("meta_description", descSuggestion)}
              />
            ) : null}
          </div>
          {hideAddress || isHome ? null : (
            <div className="flex flex-col gap-2">
              <TextField
                id={SEO_FIELD_IDS.address}
                label={`${SEO_COPY.addressLabel} (${host ?? ""}/)`}
                value={draft.slug}
                maxLength={64}
                autoComplete="off"
                spellCheck={false}
                error={slugError ?? undefined}
                onChange={(e) => set("slug", e.currentTarget.value)}
              />
              {draft.slug.trim() !== saved.slug ? (
                <p className="text-sm text-hub-ink-muted">
                  {SEO_COPY.redirectNote(saved.slug)}
                </p>
              ) : null}
            </div>
          )}
          {hideShareImage ? null : (
            <div className="flex flex-col gap-2" data-seo-share="">
              <MediaField
                id={SEO_FIELD_IDS.share}
                label={SEO_COPY.shareLabel}
                kind="image"
                allowStock
                value={draft.share_image}
                stockValue={
                  draft.share_image === "" && draft.og_image !== ""
                    ? { url: draft.og_image, creditName: draft.og_credit }
                    : null
                }
                onChange={(picked) => {
                  const p = picked[0];
                  setError(null);
                  if (!p) {
                    setDraft((d) => ({
                      ...d,
                      share_image: "",
                      og_image: "",
                      og_credit: "",
                    }));
                    return;
                  }
                  if (p.stock) {
                    setDraft((d) => ({
                      ...d,
                      share_image: "",
                      og_image: p.stock!.url,
                      og_credit: p.stock!.creditName,
                    }));
                    return;
                  }
                  setDraft((d) => ({
                    ...d,
                    share_image: p.id,
                    og_image: "",
                    og_credit: "",
                  }));
                }}
              />
              {!hasShare ? (
                <div className="flex flex-col gap-2">
                  {siteSharePreview ? (
                    // eslint-disable-next-line @next/next/no-img-element -- generated /_site file or hub thumb
                    <img
                      src={siteSharePreview}
                      alt=""
                      width={1200}
                      height={630}
                      className="aspect-[1200/630] w-full rounded border border-hub-border object-cover"
                    />
                  ) : null}
                  <p className="text-sm text-hub-ink-muted">
                    {SEO_COPY.shareEmpty}
                  </p>
                </div>
              ) : null}
            </div>
          )}
        </section>

        <section aria-labelledby="seo-checks-heading" className={sectionClass}>
          <h3 id="seo-checks-heading" className="text-xl font-semibold">
            {SEO_COPY.checks}
          </h3>
          <ChecklistPanel items={checklist} onFix={fix} />
        </section>

        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      </div>
      <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-hub-border bg-hub-surface px-6 py-4">
        {dirty ? (
          <Button variant="ghost" onClick={discard}>
            {SEO_COPY.discard}
          </Button>
        ) : null}
        <Button
          variant="primary"
          disabled={!dirty}
          loading={saving}
          loadingLabel="Saving…"
          onClick={() => void onSave()}
        >
          {SEO_COPY.save}
        </Button>
      </div>
    </Drawer>
  );
}

function Suggestion({ text, onUse }: { text: string; onUse(): void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <p className="min-w-0 text-sm text-hub-ink-muted">
        {SEO_COPY.suggested(text)}
      </p>
      <Button variant="ghost" size="sm" onClick={onUse}>
        {SEO_COPY.useThis}
      </Button>
    </div>
  );
}

/** The header button's count ("3 to check"); exported for the builder and its tests. */
export function seoBadgeLabel(items: readonly ChecklistItem[]): string | null {
  const n = items.filter((i) => i.status === "check").length;
  return n > 0 ? `${n} to check` : null;
}

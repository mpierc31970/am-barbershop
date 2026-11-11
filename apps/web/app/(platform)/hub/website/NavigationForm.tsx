"use client";
// Website › Navigation form (CONT-13; D253, D311, D-UI-P7-28; 07-25 choices 6, 10-12;
// 07-UI-SPEC "Site chrome editors" / "Navigation"; mirrors BannerForm).
//
// Max width 720px; the preview may use the full width. Heading row (right side left free
// for 07-29's History button), the Label "Changes show on your site as soon as you save.",
// then the live preview: the real SiteHeader in the org's theme inside [data-site], inert,
// with a Phone / Computer toggle that forces the layout (choice 12: a 375px box on a wide
// screen would still match lg: queries). Unpublished pages resolve in the preview. Then
// NavEditor and a sticky footer with the one primary, Save navigation. Saves are live at
// once (D253); a held result shows the warning alert (D248). Leave-guard while dirty.
// 07-26 (choice 9, UI-SPEC line 478): a Search group below the editor with the switch
// "Show a search button in the menu" (stored in the site settings part). The preview shows
// the search link from the draft switch; Save navigation saves the menu, then, only when
// the switch changed, saveSiteSettingsAction({ show_search }). If that second call fails
// the menu stays saved and an ERR-SAVE alert shows; the switch keeps its draft for a retry.
// 07-29 (CONT-36, choices 12-13): ghost History at the right of the heading row opens the
// HistoryDrawer for the "nav" part. A restore replaces the draft and saved baseline (not
// dirty, no leave-guard) and refreshes the route. The Search switch is not in this history
// (it lives in the settings part).
import {
  NAV_COPY,
  SITE_SETTINGS_COPY,
  resolveNav,
  type NavSettings,
} from "@cds/core/content";
import {
  NavEditor,
  type ChromePageOption,
  type ChromePopupOption,
} from "@cds/ui/builder";
import {
  Button,
  HISTORY_COPY,
  HistoryDrawer,
  InlineAlert,
  Switch,
  useToast,
} from "@cds/ui/hub";
import type { ResolvedMedia } from "@cds/ui/site";
import { SiteHeader, SiteThemeScope } from "@cds/ui/site/client";
import { History as HistoryIcon, Monitor, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  listSiteHistoryAction,
  restoreSiteHistoryAction,
} from "../../../actions/history";
import { saveNavAction } from "../../../actions/site-chrome";
import { saveSiteSettingsAction } from "../../../actions/site-settings";

type SiteTheme = { hash: string; css: string };
type PreviewMode = "mobile" | "desktop";

const EMPTY: NavSettings = { items: [], cta: null, held: false };
const SAVE_FAILED =
  "Your changes weren't saved. Try again; if it keeps failing, copy your text somewhere safe first.";

export const CHROME_LIVE_LABEL =
  "Changes show on your site as soon as you save.";

export function PreviewToggle({
  mode,
  onChange,
}: {
  mode: PreviewMode;
  onChange: (m: PreviewMode) => void;
}) {
  const opt = (m: PreviewMode, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      aria-pressed={mode === m}
      onClick={() => onChange(m)}
      className={`inline-flex min-h-9 items-center gap-2 rounded px-3 text-sm font-semibold transition-colors duration-150 pointer-coarse:min-h-11 ${
        mode === m
          ? "bg-hub-surface text-hub-ink shadow-sm"
          : "text-hub-ink-muted hover:text-hub-ink"
      }`}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <div
      role="group"
      aria-label="Preview size"
      className="inline-flex gap-1 rounded border border-hub-border bg-hub-surface-2 p-1"
    >
      {opt(
        "mobile",
        "Phone",
        <Smartphone aria-hidden size={16} strokeWidth={2} />,
      )}
      {opt(
        "desktop",
        "Computer",
        <Monitor aria-hidden size={16} strokeWidth={2} />,
      )}
    </div>
  );
}

export interface NavigationFormProps {
  initial: NavSettings | null;
  pages: ChromePageOption[];
  popups: ChromePopupOption[];
  theme: SiteTheme;
  brand: { name: string; logo: ResolvedMedia | null };
  /** Site settings `show_search` (07-26). */
  showSearch?: boolean;
}

export function NavigationForm({
  initial,
  pages,
  popups,
  theme,
  brand,
  showSearch = false,
}: NavigationFormProps) {
  const toast = useToast();
  const router = useRouter();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [saved, setSaved] = useState<NavSettings>(initial ?? EMPTY);
  const [draft, setDraft] = useState<NavSettings>(initial ?? EMPTY);
  const [held, setHeld] = useState(initial?.held === true);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<PreviewMode>("desktop");
  const [savedSearch, setSavedSearch] = useState(showSearch);
  const [draftSearch, setDraftSearch] = useState(showSearch);
  const searchDirty = draftSearch !== savedSearch;
  const navDirty =
    JSON.stringify({ i: draft.items, c: draft.cta }) !==
    JSON.stringify({ i: saved.items, c: saved.cta });
  const dirty = navDirty || searchDirty;

  const pageMap = useMemo(
    () => new Map(pages.map((p) => [p.id, { path: p.path, title: p.title }])),
    [pages],
  );
  const preview = resolveNav(draft, { pages: pageMap, held: false });

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (draft.cta && draft.cta.target === "") {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    const res = await saveNavAction({
      items: draft.items,
      cta: draft.cta,
    }).catch(() => null);
    setSaving(false);
    if (!res) {
      setError(SAVE_FAILED);
      return;
    }
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setSaved(res.data.nav);
    setDraft(res.data.nav);
    setShowErrors(false);
    setHeld(res.data.held);
    toast.show({ message: NAV_COPY.saved });
    if (!searchDirty) return;
    const next = draftSearch;
    const sres = await saveSiteSettingsAction({ show_search: next }).catch(
      () => null,
    );
    if (!sres || !sres.ok) {
      setError(SAVE_FAILED);
      return;
    }
    setSavedSearch(sres.data.settings.show_search);
  }

  async function restoreVersion(version: string) {
    const res = await restoreSiteHistoryAction("nav", version);
    if (!res.ok) return res;
    if (res.data.part === "nav") {
      setSaved(res.data.value);
      setDraft(res.data.value);
      setHeld(res.data.value.held === true);
      setShowErrors(false);
      setError(null);
    }
    return {
      ok: true as const,
      data: { at: res.data.at, dropped: res.data.dropped },
    };
  }

  return (
    <>
      <form
        noValidate
        onSubmit={onSave}
        className="flex flex-col gap-8 font-hub text-hub-ink"
      >
        <div className="flex max-w-[720px] flex-col gap-1">
          <div className="flex min-h-10 items-center justify-between gap-4">
            <h2 className="text-xl font-semibold text-hub-ink">Navigation</h2>
            <Button
              variant="ghost"
              icon={<HistoryIcon aria-hidden size={16} strokeWidth={2} />}
              onClick={() => setHistoryOpen(true)}
            >
              {HISTORY_COPY.button}
            </Button>
          </div>
          <p className="text-sm text-hub-ink-muted">{CHROME_LIVE_LABEL}</p>
        </div>

        <section
          aria-labelledby="nav-preview-heading"
          className="flex flex-col gap-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 id="nav-preview-heading" className="text-sm font-semibold">
              Preview
            </h3>
            <PreviewToggle mode={mode} onChange={setMode} />
          </div>
          <div className="overflow-x-auto rounded border border-hub-border-strong bg-hub-surface-2 p-0">
            <div
              className={
                mode === "mobile" ? "mx-auto w-[375px] max-w-full" : "w-full"
              }
            >
              <SiteThemeScope theme={theme} inert className="bg-site-surface">
                <SiteHeader
                  brand={brand}
                  nav={preview}
                  searchHref={draftSearch ? "/search" : null}
                  layout={mode}
                />
                <div
                  aria-hidden="true"
                  className="flex flex-col gap-2 px-6 py-6"
                >
                  <span className="h-2 w-1/3 rounded-full bg-site-surface-raised" />
                  <span className="h-2 w-1/2 rounded-full bg-site-surface-raised" />
                </div>
              </SiteThemeScope>
            </div>
          </div>
        </section>

        {held ? (
          <InlineAlert tone="warning" title="In review">
            {NAV_COPY.held}
          </InlineAlert>
        ) : null}

        <div className="max-w-[720px]">
          <NavEditor
            value={draft}
            onChange={(next) => {
              setDraft(next);
              setError(null);
            }}
            pages={pages}
            popups={popups}
            showErrors={showErrors}
          />
        </div>

        <section
          aria-labelledby="nav-search-heading"
          className="flex max-w-[720px] flex-col gap-3"
        >
          <h3 id="nav-search-heading" className="text-base font-semibold">
            {SITE_SETTINGS_COPY.searchSection}
          </h3>
          <Switch
            id="nav-show-search"
            label={SITE_SETTINGS_COPY.searchLabel}
            checked={draftSearch}
            onChange={(v) => {
              setDraftSearch(v);
              setError(null);
            }}
          />
        </section>

        {error ? (
          <div className="max-w-[720px]">
            <InlineAlert tone="error">{error}</InlineAlert>
          </div>
        ) : null}

        <div className="sticky bottom-0 z-10 -mx-4 flex max-w-[752px] flex-col gap-3 border-t border-hub-border bg-hub-surface px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-hub-ink-muted" aria-live="polite">
            {dirty ? "Unsaved changes" : ""}
          </p>
          <Button
            type="submit"
            variant="primary"
            loading={saving}
            loadingLabel="Saving…"
          >
            Save navigation
          </Button>
        </div>
      </form>
      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        part="nav"
        list={() => listSiteHistoryAction("nav")}
        restore={restoreVersion}
        onRestored={() => router.refresh()}
        unsavedChanges={dirty}
      />
    </>
  );
}

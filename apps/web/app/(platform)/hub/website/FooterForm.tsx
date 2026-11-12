"use client";
// Website › Footer form (CONT-13; D249, D253, D311; 07-25 choices 10, 12; 07-UI-SPEC "Site
// chrome editors" / "Footer"; mirrors BannerForm and NavigationForm).
//
// Heading row (right side free for 07-29's History), the live Label, the preview (the real
// SiteFooter in the org theme, inert, Phone / Computer toggle, Report link visible with an
// inert "#" href), FooterEditor and a sticky Save footer. Saves are live at once; a held
// result shows the warning alert (D248). Leave-guard while dirty.
// 07-29 (CONT-36, choice 12): ghost History in the heading row opens the HistoryDrawer for
// the "footer" part; a restore replaces the draft and saved baseline, then refreshes.
import {
  DEFAULT_FOOTER,
  FOOTER_COPY,
  resolveFooter,
  type FooterBusinessInput,
  type FooterSettings,
} from "@cds/core/content";
import { FooterEditor, type ChromePageOption } from "@cds/ui/builder";
import {
  Button,
  HISTORY_COPY,
  HistoryDrawer,
  InlineAlert,
  useToast,
} from "@cds/ui/hub";
import { SiteFooter, SiteThemeScope } from "@cds/ui/site/client";
import { History as HistoryIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  listSiteHistoryAction,
  restoreSiteHistoryAction,
} from "../../../actions/history";
import { saveFooterAction } from "../../../actions/site-chrome";
import { CHROME_LIVE_LABEL, PreviewToggle } from "./NavigationForm";

type SiteTheme = { hash: string; css: string };

const SAVE_FAILED =
  "Your changes weren't saved. Try again; if it keeps failing, copy your text somewhere safe first.";

function body(f: FooterSettings) {
  return JSON.stringify({ ...f, held: false });
}

export interface FooterFormProps {
  initial: FooterSettings | null;
  pages: ChromePageOption[];
  theme: SiteTheme;
  business: FooterBusinessInput;
}

export function FooterForm({
  initial,
  pages,
  theme,
  business,
}: FooterFormProps) {
  const toast = useToast();
  const router = useRouter();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [saved, setSaved] = useState<FooterSettings>(initial ?? DEFAULT_FOOTER);
  const [draft, setDraft] = useState<FooterSettings>(initial ?? DEFAULT_FOOTER);
  const [held, setHeld] = useState(initial?.held === true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"mobile" | "desktop">("desktop");
  const dirty = body(draft) !== body(saved);

  const pageMap = useMemo(
    () => new Map(pages.map((p) => [p.id, { path: p.path, title: p.title }])),
    [pages],
  );
  const preview = resolveFooter(
    { ...draft, held: false },
    { business, pages: pageMap, year: new Date().getFullYear() },
  );

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const res = await saveFooterAction({
      show_address: draft.show_address,
      show_hours: draft.show_hours,
      show_socials: draft.show_socials,
      extra_links: draft.extra_links,
      copyright: draft.copyright,
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
    setSaved(res.data.footer);
    setDraft(res.data.footer);
    setHeld(res.data.held);
    toast.show({ message: FOOTER_COPY.saved });
  }

  async function restoreVersion(version: string) {
    const res = await restoreSiteHistoryAction("footer", version);
    if (!res.ok) return res;
    if (res.data.part === "footer") {
      setSaved(res.data.value);
      setDraft(res.data.value);
      setHeld(res.data.value.held === true);
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
            <h2 className="text-xl font-semibold text-hub-ink">Footer</h2>
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
          aria-labelledby="footer-preview-heading"
          className="flex flex-col gap-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 id="footer-preview-heading" className="text-sm font-semibold">
              Preview
            </h3>
            <PreviewToggle mode={mode} onChange={setMode} />
          </div>
          <div className="overflow-x-auto rounded border border-hub-border-strong bg-hub-surface-2">
            <div
              className={
                mode === "mobile" ? "mx-auto w-[375px] max-w-full" : "w-full"
              }
            >
              <SiteThemeScope theme={theme} inert className="bg-site-surface">
                <SiteFooter footer={preview} layout={mode} />
              </SiteThemeScope>
            </div>
          </div>
        </section>

        {held ? (
          <InlineAlert tone="warning" title="In review">
            {FOOTER_COPY.held}
          </InlineAlert>
        ) : null}

        <div className="max-w-[720px]">
          <FooterEditor
            value={draft}
            onChange={(next) => {
              setDraft(next);
              setError(null);
            }}
            pages={pages}
            businessName={business.name}
          />
        </div>

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
            Save footer
          </Button>
        </div>
      </form>
      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        part="footer"
        list={() => listSiteHistoryAction("footer")}
        restore={restoreVersion}
        onRestored={() => router.refresh()}
        unsavedChanges={dirty}
        timeZone={business.time_zone || undefined}
      />
    </>
  );
}

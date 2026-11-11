"use client";
// Website › Site settings form (CONT-29; CONT-15 toggle; D237, D311, D-UI-P7-3, D-UI-P7-29;
// 07-UI-SPEC "Site chrome editors" / "Site settings"; 07-26 choices 3, 10-12; mirrors
// BannerForm / NavigationForm).
//
// Max width 720px; the preview may use the full width. Heading row (right side left free
// for 07-29's History button) and the live note, then the preview: the real SiteHeader in
// the org's theme inside [data-site], inert, with the Translate link while the draft switch
// is on. Sections in UI-SPEC order: Language, Search engines and AI, (07-30 Sharing),
// Cookie notice (a status line, no controls), then the sticky Save settings. Only changed
// keys are sent. An invalid "Other…" code shows its inline error before any save. Saves are
// live at once (D253). Leave-guard while dirty. Copy only from SITE_SETTINGS_COPY.
// 07-29 (CONT-36, choices 12-13): ghost History in the heading row opens the HistoryDrawer
// for the "settings" part (language, Translate, search button, AI toggle); a restore
// replaces the draft and saved baseline, then refreshes.
// 07-30 (CONT-28, D-UI-P7-3; choices 5, 7, 8): Sharing shows the generated site icon (32 and
// 180 px on white and on #1B1B19, the two fixed preview grounds) and share image from
// /_site on the primary host, and "Use a different share image" picks a library photo
// (no Free photos: the site share image needs an asset id). It saves with the other changed
// keys; allow_ai_crawlers and the rest of the seo group are kept by the chokepoint.
import {
  SITE_LANGUAGES,
  SITE_SETTINGS_COPY as COPY,
  normalizeLanguageTag,
  type ResolvedNav,
  type SiteSettingsGroup,
  type SiteSettingsPatch,
} from "@cds/core/content";
import {
  Button,
  HISTORY_COPY,
  HistoryDrawer,
  InlineAlert,
  Select,
  Switch,
  TextField,
  useToast,
} from "@cds/ui/hub";
import type { ResolvedMedia } from "@cds/ui/site";
import { SiteHeader, SiteThemeScope, TranslateLink } from "@cds/ui/site/client";
import { MediaField } from "@cds/ui/builder";
import { Cookie, History as HistoryIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  listSiteHistoryAction,
  restoreSiteHistoryAction,
} from "../../../actions/history";
import { refreshSiteIconsAction } from "../../../actions/seo";
import { saveSiteSettingsAction } from "../../../actions/site-settings";
import { CHROME_LIVE_LABEL, PreviewToggle } from "./NavigationForm";

type SiteTheme = { hash: string; css: string };

/** The two fixed preview grounds for the site icon (UI-SPEC: white and #1B1B19). */
const ICON_GROUNDS = Object.freeze([
  { id: "light", label: COPY.iconOnWhite, color: "#FFFFFF" },
  { id: "dark", label: COPY.iconOnDark, color: "#1B1B19" },
] as const);
type PreviewMode = "mobile" | "desktop";

const OTHER = "other";
const OTHER_ID = "site-language-other";

function focusOther() {
  document.getElementById(OTHER_ID)?.focus();
}
const SAVE_FAILED =
  "Your changes weren't saved. Try again; if it keeps failing, copy your text somewhere safe first.";

const LANGUAGE_OPTIONS = [
  ...SITE_LANGUAGES.map((l) => ({ value: l.code, label: l.label })),
  { value: OTHER, label: COPY.otherOption },
];

function isListed(code: string): boolean {
  return SITE_LANGUAGES.some((l) => l.code === code);
}

export interface SiteSettingsFormProps {
  initial: SiteSettingsGroup;
  theme: SiteTheme;
  previewHeader: {
    brand: { name: string; logo: ResolvedMedia | null };
    nav: ResolvedNav;
  };
  primaryHost: string | null;
  /** consentStatusText(needs), or the "couldn't check" line. */
  cookieLine: string;
  /** 07-30: the generated icon set ({ v, source }), or null when none is generated yet. */
  icons?: { v: string; source: "logo" | "wordmark" } | null;
}

type Draft = {
  choice: string;
  other: string;
  show_translate: boolean;
  allow_ai_crawlers: boolean;
  share_image: string;
};

function draftOf(g: SiteSettingsGroup): Draft {
  const listed = isListed(g.language);
  return {
    choice: listed ? g.language : OTHER,
    other: listed ? "" : g.language,
    show_translate: g.show_translate,
    allow_ai_crawlers: g.allow_ai_crawlers,
    share_image: g.share_image ?? "",
  };
}

/** The draft's language as typed (not validated). */
function rawLanguage(d: Draft): string {
  return d.choice === OTHER ? d.other.trim() : d.choice;
}

/** The changed keys only; `language` null when the Other code is invalid. */
export function siteSettingsChanges(
  saved: SiteSettingsGroup,
  d: Draft,
): { patch: SiteSettingsPatch; invalidLanguage: boolean } {
  const patch: SiteSettingsPatch = {};
  const lang = normalizeLanguageTag(rawLanguage(d));
  if (lang === null) return { patch, invalidLanguage: true };
  if (lang !== saved.language) patch.language = lang;
  if (d.show_translate !== saved.show_translate) {
    patch.show_translate = d.show_translate;
  }
  if (d.allow_ai_crawlers !== saved.allow_ai_crawlers) {
    patch.allow_ai_crawlers = d.allow_ai_crawlers;
  }
  if (d.share_image !== (saved.share_image ?? "")) {
    patch.share_image = d.share_image;
  }
  return { patch, invalidLanguage: false };
}

function CookieNoticeLine({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-3 text-base text-hub-ink">
      <Cookie
        aria-hidden
        size={20}
        strokeWidth={2}
        className="mt-0.5 shrink-0 text-hub-ink-muted"
      />
      <span data-cookie-notice-line="">{text}</span>
    </p>
  );
}

function SectionHeading({ id, children }: { id: string; children: string }) {
  return (
    <h3 id={id} className="text-base font-semibold text-hub-ink">
      {children}
    </h3>
  );
}

export function SiteSettingsForm({
  initial,
  theme,
  previewHeader,
  primaryHost,
  cookieLine,
  icons: initialIcons = null,
}: SiteSettingsFormProps) {
  const toast = useToast();
  const router = useRouter();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [saved, setSaved] = useState<SiteSettingsGroup>(initial);
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial));
  const [saving, setSaving] = useState(false);
  const [langError, setLangError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<PreviewMode>("desktop");
  const [icons, setIcons] = useState(initialIcons);

  // 07-30 choice 8, WR-C06: regenerate the icons when Site settings opens, as a server action
  // once mounted (never in the GET render or a prefetch), so the cached `v` is invalidated.
  useEffect(() => {
    let live = true;
    void refreshSiteIconsAction()
      .then((res) => {
        const next = res.ok ? res.data.icons : null;
        if (live && next) {
          setIcons((cur) =>
            cur?.v === next.v && cur.source === next.source ? cur : next,
          );
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const { patch, invalidLanguage } = siteSettingsChanges(saved, draft);
  const dirty =
    invalidLanguage ||
    Object.keys(patch).length > 0 ||
    JSON.stringify(draft) !== JSON.stringify(draftOf(saved));

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setError(null);
    if (key === "choice" || key === "other") setLangError(null);
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (invalidLanguage) {
      setLangError(COPY.invalidLanguage);
      focusOther();
      return;
    }
    if (Object.keys(patch).length === 0) {
      setDraft(draftOf(saved));
      return;
    }
    setSaving(true);
    const res = await saveSiteSettingsAction(patch).catch(() => null);
    setSaving(false);
    if (!res) {
      setError(SAVE_FAILED);
      return;
    }
    if (!res.ok) {
      if (res.message === COPY.invalidLanguage) {
        setLangError(res.message);
        return;
      }
      setError(res.message);
      return;
    }
    setSaved(res.data.settings);
    setDraft(draftOf(res.data.settings));
    toast.show({ message: COPY.saved });
  }

  async function restoreVersion(version: string) {
    const res = await restoreSiteHistoryAction("settings", version);
    if (!res.ok) return res;
    if (res.data.part === "settings") {
      setSaved(res.data.value);
      setDraft(draftOf(res.data.value));
      setLangError(null);
      setError(null);
    }
    return {
      ok: true as const,
      data: { at: res.data.at, dropped: res.data.dropped },
    };
  }

  const aiHelpId = "site-ai-help";
  const translateHelpId = "site-translate-help";

  return (
    <>
      <form
        noValidate
        onSubmit={onSave}
        className="flex flex-col gap-8 font-hub text-hub-ink"
      >
        <div className="flex max-w-[720px] flex-col gap-1">
          <div className="flex min-h-10 items-center justify-between gap-4">
            <h2 className="text-xl font-semibold text-hub-ink">
              {COPY.heading}
            </h2>
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
          aria-labelledby="site-preview-heading"
          className="flex flex-col gap-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 id="site-preview-heading" className="text-sm font-semibold">
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
                  brand={previewHeader.brand}
                  nav={previewHeader.nav}
                  searchHref={saved.show_search ? "/search" : null}
                  utilities={
                    draft.show_translate ? <TranslateLink preview /> : null
                  }
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

        <section
          aria-labelledby="site-language-heading"
          className="flex max-w-[720px] flex-col gap-6"
        >
          <SectionHeading id="site-language-heading">
            {COPY.languageSection}
          </SectionHeading>
          <Select
            id="site-language"
            label={COPY.languageLabel}
            helper={COPY.languageHelp}
            options={LANGUAGE_OPTIONS}
            value={draft.choice}
            onChange={(e) => {
              const v = e.currentTarget.value;
              set("choice", v);
              if (v === OTHER) {
                requestAnimationFrame(focusOther);
              }
            }}
          />
          {draft.choice === OTHER ? (
            <TextField
              id={OTHER_ID}
              label={COPY.otherLabel}
              helper={COPY.otherHelp}
              error={langError ?? undefined}
              value={draft.other}
              maxLength={35}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => set("other", e.currentTarget.value)}
            />
          ) : null}
          <div className="flex flex-col gap-1">
            <Switch
              id="site-translate"
              label={COPY.translateLabel}
              checked={draft.show_translate}
              aria-describedby={translateHelpId}
              onChange={(v) => set("show_translate", v)}
            />
            <p
              id={translateHelpId}
              className="pl-12 text-sm text-hub-ink-muted"
            >
              {COPY.translateHelp}
            </p>
          </div>
        </section>

        <section
          aria-labelledby="site-ai-heading"
          className="flex max-w-[720px] flex-col gap-6"
        >
          <SectionHeading id="site-ai-heading">
            {COPY.searchAiSection}
          </SectionHeading>
          <div className="flex flex-col gap-1">
            <Switch
              id="site-ai"
              label={COPY.aiLabel}
              checked={draft.allow_ai_crawlers}
              aria-describedby={aiHelpId}
              onChange={(v) => set("allow_ai_crawlers", v)}
            />
            <p id={aiHelpId} className="pl-12 text-sm text-hub-ink-muted">
              {COPY.aiHelp}
            </p>
          </div>
          {primaryHost ? (
            <a
              href={`https://${primaryHost}/sitemap.xml`}
              target="_blank"
              rel="noopener noreferrer"
              className="self-start text-sm text-hub-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
            >
              {COPY.sitemap(primaryHost)}
              <span className="sr-only"> {COPY.newTab}</span>
            </a>
          ) : null}
        </section>

        <section
          aria-labelledby="site-sharing-heading"
          className="flex max-w-[720px] flex-col gap-6"
          data-sharing-section=""
        >
          <SectionHeading id="site-sharing-heading">
            {COPY.sharingSection}
          </SectionHeading>
          {primaryHost && icons ? (
            <div className="flex flex-col gap-6 md:flex-row md:items-start">
              <div className="flex flex-col gap-2">
                <span className="text-sm font-semibold">
                  {COPY.siteIconLabel}
                </span>
                <div className="flex gap-3" data-site-icon-preview="">
                  {ICON_GROUNDS.map((g) => (
                    <div
                      key={g.id}
                      title={g.label}
                      className="flex items-center gap-3 rounded border border-hub-border p-3"
                      style={{ backgroundColor: g.color }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- generated /_site file on the tenant host */}
                      <img
                        src={`https://${primaryHost}/_site/icon-32.png?v=${icons.v}`}
                        alt=""
                        width={32}
                        height={32}
                      />
                      {/* eslint-disable-next-line @next/next/no-img-element -- generated /_site file on the tenant host */}
                      <img
                        src={`https://${primaryHost}/_site/icon-180.png?v=${icons.v}`}
                        alt={`${COPY.siteIconLabel}, ${g.label.toLowerCase()}`}
                        width={60}
                        height={60}
                        className="rounded-xl"
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-1 flex-col gap-2">
                <span className="text-sm font-semibold">
                  {COPY.shareImageLabel}
                </span>
                {/* eslint-disable-next-line @next/next/no-img-element -- generated /_site file on the tenant host */}
                <img
                  src={`https://${primaryHost}/_site/share.png?v=${icons.v}`}
                  alt={COPY.shareImageLabel}
                  width={1200}
                  height={630}
                  className="aspect-[1200/630] w-full max-w-[360px] rounded border border-hub-border object-cover"
                  data-share-preview=""
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-hub-ink-muted">{COPY.noAddress}</p>
          )}
          <p className="text-sm text-hub-ink-muted">
            {icons?.source === "wordmark"
              ? COPY.madeFromName
              : COPY.madeFromLogo}{" "}
            <a
              href={COPY.businessInfoHref}
              className="text-hub-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
            >
              {icons?.source === "wordmark" ? COPY.addLogo : COPY.changeLogo}
            </a>
          </p>
          <MediaField
            id="site-share-image"
            label="Use a different share image"
            helper={COPY.shareImageHelp}
            kind="image"
            value={draft.share_image}
            onChange={(picked) => set("share_image", picked[0]?.id ?? "")}
          />
        </section>

        <section
          aria-labelledby="site-cookie-heading"
          className="flex max-w-[720px] flex-col gap-3"
        >
          <SectionHeading id="site-cookie-heading">
            {COPY.cookieSection}
          </SectionHeading>
          <CookieNoticeLine text={cookieLine} />
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
            {COPY.save}
          </Button>
        </div>
      </form>
      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        part="settings"
        list={() => listSiteHistoryAction("settings")}
        restore={restoreVersion}
        onRestored={() => router.refresh()}
        unsavedChanges={dirty}
      />
    </>
  );
}

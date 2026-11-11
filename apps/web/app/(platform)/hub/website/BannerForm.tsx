"use client";
// Website › Banner form (CONT-11, CONT-31; D117, D123, D119; 03-UI-SPEC "Banner tab",
// "Interaction states" Banner row, Copywriting; impeccable standard).
//
// Max width 720px. Focal point: the live preview on top, rendered with the public Banner
// component inside SiteThemeScope (exact visitor markup in the org's real theme, inert so
// its link can't navigate away; THEME-02, 04-UI-SPEC "Theme in the hub"), with the status
// line under it. The theme arrives precomputed from the server (BannerTab), never fetched. Then the Show banner switch, Message with a live
// counter, the optional link, and "Schedule (optional)". One primary: Save banner.
//
// Times: datetime-local values are wall time in the owner's browser zone and are turned
// into UTC instants with localInputToUtcIso before they leave the browser (RESEARCH
// Pitfall 8); the server re-validates everything. The form mounts after hydration (the
// server can't know the browser zone), with a skeleton until then.
// 07-29 (CONT-36, choice 12; 07-UI-SPEC "The Banner tab (P3) gains the same History
// button"): a heading row (H2 "Banner" + ghost History) opens the HistoryDrawer for the
// "banner" part, in the same browser zone as the rest of the form. A restore replaces the
// draft and saved baseline (a switched-off banner comes back off), then refreshes.
import { BANNER_MESSAGE_MAX, type BannerSettings } from "@cds/core/content";
import {
  browserTimeZone,
  formatShortInZone,
  localInputToUtcIso,
  utcIsoToLocalInput,
} from "@cds/ui/builder";
import {
  Button,
  HISTORY_COPY,
  HistoryDrawer,
  InlineAlert,
  Skeleton,
  Switch,
  TextField,
  useToast,
} from "@cds/ui/hub";
import { Banner, SiteThemeScope } from "@cds/ui/site/client";
import { History as HistoryIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { saveBannerAction } from "../../../actions/banner";
import {
  listSiteHistoryAction,
  restoreSiteHistoryAction,
} from "../../../actions/history";
import {
  BANNER_HELD_COPY,
  BANNER_SAVED_COPY,
  bannerErrorField,
  bannerFieldErrors,
  bannerStatusLine,
  previewBanner,
  type BannerField,
} from "./banner-status";

type Draft = {
  enabled: boolean;
  message: string;
  link_text: string;
  link_url: string;
  starts_local: string;
  ends_local: string;
};

const FIELD_ORDER: readonly BannerField[] = [
  "message",
  "link_text",
  "link_url",
  "starts_at",
  "ends_at",
];

const FIELD_ID: Record<BannerField, string> = {
  message: "banner-message",
  link_text: "banner-link-text",
  link_url: "banner-link-url",
  starts_at: "banner-starts",
  ends_at: "banner-ends",
};

function toDraft(b: BannerSettings | null, timeZone: string): Draft {
  return {
    enabled: b?.enabled === true,
    message: b?.message ?? "",
    link_text: b?.link_text ?? "",
    link_url: b?.link_url ?? "",
    starts_local: b?.starts_at ? utcIsoToLocalInput(b.starts_at, timeZone) : "",
    ends_local: b?.ends_at ? utcIsoToLocalInput(b.ends_at, timeZone) : "",
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return (
    a.enabled === b.enabled &&
    a.message === b.message &&
    a.link_text === b.link_text &&
    a.link_url === b.link_url &&
    a.starts_local === b.starts_local &&
    a.ends_local === b.ends_local
  );
}

type SiteTheme = { hash: string; css: string };

const noopSubscribe = () => () => {};

/** Mounts the form once the browser zone is known; a skeleton form until then. */
export function BannerForm({
  initial,
  theme,
}: {
  initial: BannerSettings | null;
  /** The org's resolved theme (resolveTheme on the server). */
  theme: SiteTheme;
}) {
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  if (!mounted) {
    return (
      <div className="flex max-w-[720px] flex-col gap-6" aria-busy="true">
        <Skeleton rows={1} rowHeight={96} />
        <Skeleton rows={4} rowHeight={64} />
      </div>
    );
  }
  return (
    <BannerFields
      initial={initial}
      timeZone={browserTimeZone()}
      theme={theme}
    />
  );
}

export interface BannerFieldsProps {
  initial: BannerSettings | null;
  /** IANA zone the datetime fields and the status line use. */
  timeZone: string;
  /** The org's resolved theme; the preview paints with it. */
  theme: SiteTheme;
}

export function BannerFields({ initial, timeZone, theme }: BannerFieldsProps) {
  const toast = useToast();
  const router = useRouter();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [saved, setSaved] = useState<Draft>(() => toDraft(initial, timeZone));
  const [draft, setDraft] = useState<Draft>(saved);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<{
    field: BannerField | null;
    message: string;
  } | null>(null);
  const [held, setHeld] = useState(false);
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const format = useMemo(
    () => (iso: string) => formatShortInZone(iso, timeZone),
    [timeZone],
  );
  const starts_at = localInputToUtcIso(draft.starts_local, timeZone);
  const ends_at = localInputToUtcIso(draft.ends_local, timeZone);
  const settings: BannerSettings = {
    enabled: draft.enabled,
    message: draft.message,
    link_text: draft.link_text,
    link_url: draft.link_url,
    starts_at: starts_at || null,
    ends_at: ends_at || null,
  };
  const dirty = !sameDraft(draft, saved);
  const status = bannerStatusLine(settings, new Date(), format);

  const localErrors = submitted
    ? bannerFieldErrors({ ...settings, starts_at, ends_at, ...draft }, format)
    : {};
  const errors: Partial<Record<BannerField, string>> = { ...localErrors };
  if (serverError?.field && !errors[serverError.field]) {
    errors[serverError.field] = serverError.message;
  }
  const errorCount = Object.keys(errors).length;

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setServerError(null);
  }

  function focusField(field: BannerField) {
    formRef.current?.querySelector<HTMLElement>(`#${FIELD_ID[field]}`)?.focus();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    setServerError(null);
    const check = bannerFieldErrors(
      { ...settings, starts_at, ends_at, ...draft },
      format,
    );
    const first = FIELD_ORDER.find((f) => check[f]);
    if (first) {
      focusField(first);
      return;
    }
    setSaving(true);
    const res = await saveBannerAction(settings).catch(() => null);
    setSaving(false);
    if (!res) {
      setServerError({
        field: null,
        message:
          "Your changes weren't saved. Try again; if it keeps failing, copy your text somewhere safe first.",
      });
      return;
    }
    if (!res.ok) {
      const field =
        res.code === "invalid_input" ? bannerErrorField(res.message) : null;
      setServerError({ field, message: res.message });
      if (field) focusField(field);
      return;
    }
    const next = toDraft(res.data.banner, timeZone);
    setSaved(next);
    setDraft(next);
    setSubmitted(false);
    setHeld(res.data.held);
    toast.show({
      message: res.data.held ? BANNER_HELD_COPY : BANNER_SAVED_COPY,
    });
  }

  async function restoreVersion(version: string) {
    const res = await restoreSiteHistoryAction("banner", version);
    if (!res.ok) return res;
    if (res.data.part === "banner") {
      const next = toDraft(res.data.value, timeZone);
      setSaved(next);
      setDraft(next);
      setSubmitted(false);
      setServerError(null);
      setHeld(false);
    }
    return {
      ok: true as const,
      data: { at: res.data.at, dropped: res.data.dropped },
    };
  }

  return (
    <>
      <form
        ref={formRef}
        noValidate
        onSubmit={onSubmit}
        className="flex max-w-[720px] flex-col gap-8 font-hub text-hub-ink"
      >
        <div className="flex min-h-10 items-center justify-between gap-4">
          <h2 className="text-xl font-semibold text-hub-ink">Banner</h2>
          <Button
            variant="ghost"
            icon={<HistoryIcon aria-hidden size={16} strokeWidth={2} />}
            onClick={() => setHistoryOpen(true)}
          >
            {HISTORY_COPY.button}
          </Button>
        </div>

        <section
          aria-labelledby="banner-preview-heading"
          className="flex flex-col gap-2"
        >
          <h3
            id="banner-preview-heading"
            className="text-sm font-semibold text-hub-ink"
          >
            Preview
          </h3>
          <div className="overflow-hidden rounded border border-hub-border">
            <SiteThemeScope theme={theme} inert className="bg-site-surface">
              <Banner banner={previewBanner(settings)} now={new Date()} />
              <div aria-hidden="true" className="flex flex-col gap-2 px-6 py-4">
                <span className="h-2 w-1/3 rounded-full bg-site-surface-raised" />
                <span className="h-2 w-1/2 rounded-full bg-site-surface-raised" />
              </div>
            </SiteThemeScope>
          </div>
          <p className="text-sm text-hub-ink-muted tabular-nums">{status}</p>
        </section>

        {held ? (
          <InlineAlert tone="warning" title="In review">
            {BANNER_HELD_COPY}
          </InlineAlert>
        ) : null}

        <div className="flex flex-col gap-6">
          <Switch
            id="banner-enabled"
            label="Show banner"
            checked={draft.enabled}
            onChange={(v) => set("enabled", v)}
          />
          <TextField
            id={FIELD_ID.message}
            label="Message"
            value={draft.message}
            maxLength={BANNER_MESSAGE_MAX * 2}
            counter={{ value: draft.message.length, max: BANNER_MESSAGE_MAX }}
            helper="One short line. It sits above every page of your site."
            error={errors.message}
            onChange={(e) => set("message", e.currentTarget.value)}
          />
          <div className="grid gap-6 sm:grid-cols-2">
            <TextField
              id={FIELD_ID.link_text}
              label="Link text (optional)"
              value={draft.link_text}
              placeholder="Book now"
              error={errors.link_text}
              onChange={(e) => set("link_text", e.currentTarget.value)}
            />
            <TextField
              id={FIELD_ID.link_url}
              label="Link URL"
              type="url"
              inputMode="url"
              value={draft.link_url}
              placeholder="/book or https://…"
              helper="A page on your site, like /book, or a full web address."
              error={errors.link_url}
              onChange={(e) => set("link_url", e.currentTarget.value)}
            />
          </div>

          <fieldset className="flex flex-col gap-4">
            <legend className="mb-1 text-base font-semibold text-hub-ink">
              Schedule (optional)
            </legend>
            <p className="text-sm text-hub-ink-muted">
              Leave both empty to show it until you turn it off. Times are in
              your time zone ({timeZone}).
            </p>
            <div className="grid gap-6 sm:grid-cols-2">
              <TextField
                id={FIELD_ID.starts_at}
                label="Starts"
                type="datetime-local"
                value={draft.starts_local}
                error={errors.starts_at}
                onChange={(e) => set("starts_local", e.currentTarget.value)}
              />
              <TextField
                id={FIELD_ID.ends_at}
                label="Ends"
                type="datetime-local"
                value={draft.ends_local}
                error={errors.ends_at}
                onChange={(e) => set("ends_local", e.currentTarget.value)}
              />
            </div>
            {draft.starts_local !== "" || draft.ends_local !== "" ? (
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDraft((d) => ({
                      ...d,
                      starts_local: "",
                      ends_local: "",
                    }));
                    setServerError(null);
                  }}
                >
                  Clear dates
                </Button>
              </div>
            ) : null}
          </fieldset>
        </div>

        {serverError && !serverError.field ? (
          <InlineAlert tone="error">{serverError.message}</InlineAlert>
        ) : null}

        <div className="flex flex-col gap-3 border-t border-hub-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-hub-ink-muted" aria-live="polite">
            {errorCount > 1
              ? `${errorCount} fields need attention`
              : dirty
                ? "Unsaved changes"
                : ""}
          </p>
          <Button
            type="submit"
            variant="primary"
            loading={saving}
            loadingLabel="Saving…"
          >
            Save banner
          </Button>
        </div>
      </form>
      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        part="banner"
        list={() => listSiteHistoryAction("banner")}
        restore={restoreVersion}
        onRestored={() => router.refresh()}
        unsavedChanges={dirty}
        timeZone={timeZone}
      />
    </>
  );
}

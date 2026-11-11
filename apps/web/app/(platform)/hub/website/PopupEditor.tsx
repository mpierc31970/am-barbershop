"use client";
// Pop-up editor pane (CONT-12, CONT-31; D118, D124, D119; 03-UI-SPEC "Pop-ups tab";
// impeccable standard). Five sections with 48px above each heading:
//   1 Name  2 Content (one column of items; buttons follow links only)  3 When it appears
//   (the focal point: the decision that shapes the visitor's experience, the largest
//   control group)  4 How often  5 Where (hidden for "When someone clicks a button").
// Footer: Save pop-up (the one primary) and Preview pop-up, which opens the saved pop-up's
// real public dialog (rendered by PopupsTab inside [data-site]).
//
// Content items stay local until Save pop-up; the server validates and sanitizes the whole
// pop-up again (T-03-60) and checks every chosen page belongs to the site (T-03-59).
import {
  POPUP_DELAY,
  POPUP_NAME_MAX,
  POPUP_SCROLL,
  type ColumnItem,
  type PopupFrequency,
  type PopupRecord,
  type PopupTrigger,
} from "@cds/core/content";
import { ItemListEditor } from "@cds/ui/builder";
import {
  Button,
  Dialog,
  FormOptionsProvider,
  InlineAlert,
  RadioCardGroup,
  TextField,
  useToast,
  type RadioCardOption,
} from "@cds/ui/hub";
import { Eye } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createFormAction } from "../../../actions/forms";
import { savePopupAction } from "../../../actions/popups";
import { useRegisterNavGuard } from "../nav-guard";
import {
  POPUP_CLICK_WHERE_COPY,
  POPUP_HELD_COPY,
  POPUP_NAME_HELPER,
  POPUP_SAVED_COPY,
  draftFromPopup,
  draftToInput,
  newPopupDraft,
  popupErrorField,
  popupFieldErrors,
  popupsHref,
  showFrequencySection,
  showWhereSection,
  type PopupDraft,
  type PopupField,
  type PopupWhere,
} from "./popup-logic";

const ERR_SAVE =
  "Your changes weren't saved. Try again; if it keeps failing, copy your text somewhere safe first.";

const TRIGGER_OPTIONS: readonly RadioCardOption<PopupTrigger>[] = [
  {
    value: "click",
    title: "When someone clicks a button",
    description: "Point a button at it in the page builder.",
  },
  {
    value: "delay",
    title: "After a delay",
    description: "A few seconds after the page opens.",
  },
  {
    value: "scroll",
    title: "When they scroll",
    description: "Once they've read part of the page.",
  },
  {
    value: "exit-intent",
    title: "When they're about to leave",
    description: "Computers only. Phones and tablets don't show it.",
  },
  {
    value: "page-load",
    title: "As soon as the page opens",
  },
];

const FREQUENCY_OPTIONS: readonly RadioCardOption<PopupFrequency>[] = [
  { value: "every-visit", title: "Every visit" },
  {
    value: "once-per-session",
    title: "Once per session",
    description: "Again the next time they come back.",
  },
  {
    value: "once-per-visitor",
    title: "Once per visitor",
    description: "Only the first time, on this device.",
  },
];

const WHERE_OPTIONS: readonly RadioCardOption<PopupWhere>[] = [
  { value: "all-pages", title: "Every page" },
  { value: "selected-pages", title: "Only these pages" },
];

const FIELD_ID: Record<PopupField, string> = {
  name: "popup-name",
  delay: "popup-delay",
  scroll: "popup-scroll",
  pages: "popup-pages",
};

const FIELD_ORDER: readonly PopupField[] = ["name", "delay", "scroll", "pages"];

function sameDraft(a: PopupDraft, b: PopupDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h3 id={id} className="text-xl leading-tight font-semibold text-hub-ink">
        {title}
      </h3>
      {children}
    </section>
  );
}

export interface PopupEditorProps {
  /** The saved pop-up, or null while creating one. */
  popup: PopupRecord | null;
  /** The site's pages, for "Only these pages". */
  pages: readonly { id: string; title: string }[];
  /** The site's forms for Form items (07-18 choice 3; deleted ones flagged). */
  forms?: readonly { id: string; name: string; deleted?: boolean }[];
}

const NO_FORMS: readonly { id: string; name: string; deleted?: boolean }[] = [];

export function PopupEditor({
  popup,
  pages,
  forms = NO_FORMS,
}: PopupEditorProps) {
  const router = useRouter();
  const toast = useToast();
  const [saved, setSaved] = useState<PopupDraft>(() =>
    popup ? draftFromPopup(popup) : newPopupDraft(),
  );
  const [draft, setDraft] = useState<PopupDraft>(saved);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<{
    field: PopupField | null;
    message: string;
  } | null>(null);
  const [held, setHeld] = useState(false);
  const [saving, setSaving] = useState(false);
  // A hub navigation waiting on the leave dialog (03-UI-REVIEW Fix 4).
  const [pendingNav, setPendingNav] = useState<{ run: () => void } | null>(
    null,
  );
  const [guardSaving, setGuardSaving] = useState(false);
  const rootRef = useRef<HTMLFormElement>(null);

  const dirty = popup === null || !sameDraft(draft, saved);
  // Edits the owner would lose by leaving: a new pop-up counts only once something changed.
  const changed = !sameDraft(draft, saved);
  const changedRef = useRef(changed);
  useEffect(() => {
    changedRef.current = changed;
  });
  const errors: Partial<Record<PopupField, string>> = submitted
    ? popupFieldErrors(draft)
    : {};
  if (serverError?.field && !errors[serverError.field]) {
    errors[serverError.field] = serverError.message;
  }
  const errorCount = Object.keys(errors).length;

  useEffect(() => {
    if (!changed) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [changed]);

  // In-hub links (Website tabs, the pop-up list, sidebar, Sign out) ask before they drop
  // unsaved edits; beforeunload never fires for App Router navigations (WR-B05).
  useRegisterNavGuard((go) => {
    if (!changedRef.current) return false;
    setPendingNav({ run: go });
    return true;
  });

  function set<K extends keyof PopupDraft>(key: K, value: PopupDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setServerError(null);
  }

  function focusField(field: PopupField) {
    const el = rootRef.current?.querySelector<HTMLElement>(
      field === "pages" ? `#${FIELD_ID.pages} input` : `#${FIELD_ID[field]}`,
    );
    el?.focus();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await save();
  }

  /** Validate and save; true when the pop-up saved. */
  async function save(): Promise<boolean> {
    setSubmitted(true);
    setServerError(null);
    const check = popupFieldErrors(draft);
    const first = FIELD_ORDER.find((f) => check[f]);
    if (first) {
      focusField(first);
      return false;
    }
    setSaving(true);
    const res = await savePopupAction(
      draftToInput(draft, popup?.id ?? null),
    ).catch(() => null);
    setSaving(false);
    if (!res) {
      setServerError({ field: null, message: ERR_SAVE });
      return false;
    }
    if (!res.ok) {
      const field =
        res.code === "invalid_input" ? popupErrorField(res.message) : null;
      setServerError({ field, message: res.message });
      if (field) focusField(field);
      return false;
    }
    const next = draftFromPopup(res.data.popup);
    setSaved(next);
    setDraft(next);
    changedRef.current = false;
    setSubmitted(false);
    setHeld(res.data.held);
    toast.show({
      message: res.data.held ? POPUP_HELD_COPY : POPUP_SAVED_COPY,
    });
    if (popup === null) {
      router.replace(popupsHref(res.data.popup.id), { scroll: false });
    }
    router.refresh();
    return true;
  }

  const onItems = async (items: ColumnItem[]) => {
    set("items", items);
  };

  const togglePage = (id: string, on: boolean) => {
    setDraft((d) => ({
      ...d,
      page_ids: on
        ? [...d.page_ids.filter((p) => p !== id), id]
        : d.page_ids.filter((p) => p !== id),
    }));
    setServerError(null);
  };

  const title = popup ? popup.name : "New pop-up";

  return (
    <>
      <form
        ref={rootRef}
        noValidate
        onSubmit={onSubmit}
        aria-labelledby="popup-editor-title"
        className="flex max-w-[720px] flex-col gap-12 font-hub text-hub-ink"
      >
        <div className="flex flex-col gap-2">
          <h2
            id="popup-editor-title"
            className="text-[1.5rem] leading-tight font-semibold"
          >
            {title}
          </h2>
          {popup && !popup.enabled ? (
            <p className="text-sm text-hub-ink-muted">
              Off. Turn on Show pop-up in the list when it&apos;s ready.
            </p>
          ) : null}
          {held ? (
            <InlineAlert tone="warning" title="In review">
              {POPUP_HELD_COPY}
            </InlineAlert>
          ) : null}
        </div>

        <Section id="popup-sec-name" title="Name">
          <TextField
            id={FIELD_ID.name}
            label="Pop-up name"
            value={draft.name}
            maxLength={POPUP_NAME_MAX * 2}
            counter={{ value: draft.name.length, max: POPUP_NAME_MAX }}
            helper={POPUP_NAME_HELPER}
            error={errors.name}
            onChange={(e) => set("name", e.currentTarget.value)}
          />
        </Section>

        <Section id="popup-sec-content" title="Content">
          <p className="-mt-2 text-sm text-hub-ink-muted">
            What visitors see in the pop-up. Buttons here go to a link.
          </p>
          <FormOptionsProvider forms={forms} createForm={createFormAction}>
            <ItemListEditor
              items={draft.items}
              popups={[]}
              allowPopupButton={false}
              onChange={onItems}
            />
          </FormOptionsProvider>
        </Section>

        <Section id="popup-sec-when" title="When it appears">
          <p className="-mt-2 text-sm text-hub-ink-muted">
            On phones, pop-ups open only from a button, so visitors are never
            interrupted.
          </p>
          <RadioCardGroup
            name="popup-trigger"
            legend="When it appears"
            hideLegend
            options={TRIGGER_OPTIONS}
            value={draft.trigger}
            onChange={(v) => set("trigger", v)}
          />
          {draft.trigger === "delay" ? (
            <div className="max-w-[240px]">
              <TextField
                id={FIELD_ID.delay}
                label="Seconds after the page opens"
                type="number"
                inputMode="numeric"
                min={POPUP_DELAY.min}
                max={POPUP_DELAY.max}
                step={1}
                value={draft.delay}
                helper={`${POPUP_DELAY.min} to ${POPUP_DELAY.max} seconds.`}
                error={errors.delay}
                onChange={(e) => set("delay", e.currentTarget.value)}
              />
            </div>
          ) : null}
          {draft.trigger === "scroll" ? (
            <div className="max-w-[240px]">
              <TextField
                id={FIELD_ID.scroll}
                label="How far down the page (%)"
                type="number"
                inputMode="numeric"
                min={POPUP_SCROLL.min}
                max={POPUP_SCROLL.max}
                step={5}
                value={draft.scroll}
                helper={`${POPUP_SCROLL.min} to ${POPUP_SCROLL.max} percent.`}
                error={errors.scroll}
                onChange={(e) => set("scroll", e.currentTarget.value)}
              />
            </div>
          ) : null}
          {!showWhereSection(draft.trigger) ? (
            <p className="text-sm text-hub-ink-muted">
              {POPUP_CLICK_WHERE_COPY}
            </p>
          ) : null}
        </Section>

        {showFrequencySection(draft.trigger) ? (
          <Section id="popup-sec-often" title="How often">
            <RadioCardGroup
              name="popup-frequency"
              legend="How often"
              hideLegend
              options={FREQUENCY_OPTIONS}
              value={draft.frequency}
              onChange={(v) => set("frequency", v)}
            />
          </Section>
        ) : null}

        {showWhereSection(draft.trigger) ? (
          <Section id="popup-sec-where" title="Where">
            <RadioCardGroup
              name="popup-where"
              legend="Where"
              hideLegend
              options={WHERE_OPTIONS}
              value={draft.where}
              onChange={(v) => set("where", v)}
            />
            {draft.where === "selected-pages" ? (
              <fieldset
                id={FIELD_ID.pages}
                aria-describedby={
                  errors.pages ? "popup-pages-error" : undefined
                }
                className="flex flex-col gap-1 rounded border border-hub-border p-2"
              >
                <legend className="sr-only">Pages</legend>
                {pages.length === 0 ? (
                  <p className="p-2 text-sm text-hub-ink-muted">
                    This site has no pages yet.
                  </p>
                ) : (
                  pages.map((p) => {
                    const id = `popup-page-${p.id}`;
                    return (
                      <label
                        key={p.id}
                        htmlFor={id}
                        className="flex min-h-11 cursor-pointer items-center gap-3 rounded px-2 hover:bg-hub-surface-2"
                      >
                        <input
                          id={id}
                          type="checkbox"
                          className="h-4 w-4"
                          checked={draft.page_ids.includes(p.id)}
                          onChange={(e) =>
                            togglePage(p.id, e.currentTarget.checked)
                          }
                        />
                        <span className="text-base">{p.title}</span>
                      </label>
                    );
                  })
                )}
              </fieldset>
            ) : null}
            {errors.pages ? (
              <p id="popup-pages-error" className="text-sm text-hub-danger">
                {errors.pages}
              </p>
            ) : null}
          </Section>
        ) : null}

        {serverError && !serverError.field ? (
          <InlineAlert tone="error">{serverError.message}</InlineAlert>
        ) : null}

        <div className="flex flex-col gap-3 border-t border-hub-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-hub-ink-muted" aria-live="polite">
            {errorCount > 1
              ? `${errorCount} fields need attention`
              : popup && dirty
                ? "Unsaved changes. Preview shows the last saved version."
                : ""}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              icon={<Eye aria-hidden size={16} strokeWidth={2} />}
              disabled={popup === null}
              aria-haspopup="dialog"
              data-cds-popup-open={popup?.id}
              title={
                popup === null ? "Save the pop-up to preview it" : undefined
              }
            >
              Preview pop-up
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={saving}
              loadingLabel="Saving…"
            >
              Save pop-up
            </Button>
          </div>
        </div>
      </form>
      <Dialog
        open={pendingNav !== null}
        onClose={() => setPendingNav(null)}
        title="Save changes to this pop-up?"
        footer={
          <>
            <Button onClick={() => setPendingNav(null)}>Keep editing</Button>
            <Button
              variant="ghost"
              onClick={() => {
                const go = pendingNav?.run;
                changedRef.current = false;
                setDraft(saved);
                setServerError(null);
                setSubmitted(false);
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
                const ok = await save();
                setGuardSaving(false);
                setPendingNav(null);
                if (ok) go?.();
              }}
            >
              Save and continue
            </Button>
          </>
        }
      >
        You changed this pop-up but haven&apos;t saved it.
      </Dialog>
    </>
  );
}

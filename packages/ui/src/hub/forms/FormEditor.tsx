"use client";
// Three-pane form editor (07-18; CONT-25, D231, D233, D270, D119, D-UI-P7-32; 07-UI-SPEC
// "Form editor"). Header: "← Forms", the name as a Display button that becomes a TextField
// (Enter or blur commits, Escape cancels), "In review" when held, the live note, Save form
// (the one primary, disabled until canSave) and Discard changes when dirty.
//
// Panes: field list 320px on surface-2 | settings (max 480px) | live preview. From 1280px all
// three show; 1024-1279px shows list | settings with a Preview form toggle swapping settings
// for the preview; below 1024px one pane shows at a time with a back control (P3 pattern).
//
// draft / saved like PopupEditor; dirty = JSON inequality, reported through onDirtyChange so
// the panel can guard navigation. Blocked fields disable Save (D233; the chokepoint refuses
// them anyway). Server field errors select the right field and focus its first invalid input
// under a "N fields need attention" summary. Read-only members get disabled fieldsets and no
// write controls. No fetching and no next/*: everything arrives as props.
import {
  FORM_FIELD_GROUPS,
  formErrorsSummary,
  type FormField,
  type FormFieldType,
} from "@cds/core/forms";
import { ArrowLeft, Eye } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { HubLinkComponent } from "../AddonCard";
import { Button } from "../Button";
import { UNDO_TOAST_MS, useToast } from "../Toast";
import type { HubActionResult } from "../addon-types";
import { InlineAlert } from "../feedback";
import { FieldList, SETTINGS_ROW } from "./FieldList";
import { FieldSettingsPane } from "./FieldSettingsPane";
import { FormPreview } from "./FormPreview";
import { FormSettingsPane } from "./FormSettingsPane";
import { ProRulesEditor } from "./ProRulesEditor";
import { ProSettingsPanel, type ProSettingsChange } from "./ProSettingsPanel";
import {
  BUILDER_PRO_KEY,
  FIELD_REMOVED_TOAST,
  HELD_TOAST,
  IN_REVIEW,
  LIVE_NOTE,
  NAME_HELPER,
  READ_ONLY_LINE,
  SAVED_TOAST,
  addField,
  addStep,
  canSave,
  changeFieldType,
  clientFieldErrors,
  draftFromRecord,
  draftToInput,
  hasProContent,
  isDirty,
  moveField,
  moveFieldInSteps,
  proOf,
  removeField,
  removeStep,
  renameStep,
  ruleFor,
  serverErrorTarget,
  setAutoReply,
  setRouting,
  setRule,
  setSaveResume,
  splitIntoSteps,
  syncSteps,
  updateField,
  type EmailRouteView,
  type FormDraft,
} from "./form-logic";

export const SAVE_FAILED_COPY =
  "Your changes weren't saved. Try again; if it keeps failing, copy your text somewhere safe first.";

export type FormSaveInput = ReturnType<typeof draftToInput>;
export type FormSaveResult = HubActionResult<
  | { saved: { form: unknown; held: boolean } }
  | { invalid: { errors: Record<string, string>; message: string } }
>;

export interface FormEditorProps {
  form: FormDraft & { id: string };
  theme: { hash: string; css: string };
  pages: readonly { id: string; title: string }[];
  routes: readonly EmailRouteView[] | null;
  readOnly: boolean;
  onSave: (input: FormSaveInput) => Promise<FormSaveResult>;
  onDirtyChange?: (dirty: boolean) => void;
  onExternalFormHelp: () => void;
  LinkComponent: HubLinkComponent;
  backHref: string;
  /** The org's entitlement set from the server (10-17, CONTEXT A3). Default: none. */
  entitlements?: ReadonlySet<string>;
  /** purchases:run, for the owner's "Add Builder Pro" link. */
  canBuy?: boolean;
}

const LINK =
  "inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-hub-accent " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

function stripId(form: FormDraft & { id: string }): FormDraft {
  const { id: _id, ...rest } = form;
  void _id;
  return draftFromRecord(rest);
}

export function FormEditor({
  form,
  theme,
  pages,
  routes,
  readOnly,
  onSave,
  onDirtyChange,
  onExternalFormHelp,
  LinkComponent,
  backHref,
  entitlements,
  canBuy,
}: FormEditorProps) {
  const id = form.id;
  const uid = useId().replace(/[^a-zA-Z0-9-]/g, "");
  const [saved, setSaved] = useState<FormDraft>(() => stripId(form));
  const [draft, setDraft] = useState<FormDraft>(() => stripId(form));
  const [selectedId, setSelectedId] = useState<string>(SETTINGS_ROW);
  const [pane, setPane] = useState<"list" | "detail">("list");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const toast = useToast();
  const focusNext = useRef<string | null>(null);
  const focusInvalid = useRef(false);
  const latest = useRef(draft);
  latest.current = draft;

  // Builder Pro (10-39): active = in the server's entitlement set. Paused = not active but
  // the stored form has Pro settings (a lapse): shown read-only, never sent on save.
  const proActive = entitlements?.has(BUILDER_PRO_KEY) ?? false;
  const proPaused = !proActive && hasProContent(saved.pro);
  const sync = (d: FormDraft) => (proActive ? syncSteps(d) : d);

  const dirty = isDirty(draft, saved);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (focusNext.current) {
      const el = document.getElementById(focusNext.current);
      focusNext.current = null;
      el?.focus();
    }
    if (focusInvalid.current) {
      focusInvalid.current = false;
      document
        .querySelector<HTMLElement>(`#${uid}-settings [aria-invalid="true"]`)
        ?.focus();
    }
  });

  const errors = useMemo(
    () => ({ ...serverErrors, ...clientFieldErrors(draft, { proActive }) }),
    [serverErrors, draft, proActive],
  );
  const selectedField = draft.fields.find((f) => f.id === selectedId) ?? null;
  const limitReached = draft.fields.length >= 40;
  const allowSave = canSave(draft, saved, readOnly) && !saving;
  const rowPrefix = `${uid}-row`;
  const fieldPrefix = `${uid}-f`;

  function clearServerError(key: string) {
    setServerErrors((e) => {
      if (!Object.hasOwn(e, key)) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  }

  function select(next: string) {
    setSelectedId(next);
    setPane("detail");
    setPreviewOpen(false);
  }

  function onAdd(type: FormFieldType) {
    const r = addField(latest.current, type);
    if (r.limitReached || !r.id) return;
    setDraft(sync(r.draft));
    select(r.id);
    focusNext.current = `${fieldPrefix}-${r.id}-label`;
  }

  function onMove(from: number, to: number, kind?: "button" | "drag") {
    setDraft((d) =>
      proActive && (d.pro?.steps.length ?? 0) > 0
        ? moveFieldInSteps(d, from, to, kind)
        : moveField(d, from, to),
    );
  }

  function onProChange(change: ProSettingsChange) {
    setDraft((d) => {
      switch (change.kind) {
        case "steps":
          return splitIntoSteps(d, change.on);
        case "add-step":
          return addStep(d);
        case "rename-step":
          return renameStep(d, change.stepId, change.title);
        case "remove-step":
          return removeStep(d, change.stepId);
        case "auto-reply":
          return setAutoReply(d, change.patch);
        case "routing":
          return setRouting(d, change.routing);
        case "save-resume":
          return setSaveResume(d, change.on);
        default:
          return d;
      }
    });
    for (const k of ["pro", "pro.steps", "pro.auto_reply", "pro.routing"])
      clearServerError(k);
  }

  function patchField(fid: string, patch: Partial<Omit<FormField, "id">>) {
    setDraft((d) => updateField(d, fid, patch));
    clearServerError(fid);
  }

  function onChangeType(fid: string, type: FormFieldType) {
    setDraft((d) => ({
      ...d,
      fields: d.fields.map((f) =>
        f.id === fid ? changeFieldType(f, type) : f,
      ),
    }));
    clearServerError(fid);
  }

  function onRemove(fid: string) {
    const r = removeField(latest.current, fid);
    if (r.index === -1) return;
    setDraft(sync(r.draft));
    clearServerError(fid);
    const next = r.draft.fields[r.index] ?? r.draft.fields[r.index - 1] ?? null;
    setSelectedId(next ? next.id : SETTINGS_ROW);
    setPane("list");
    focusNext.current = `${rowPrefix}-${next ? next.id : SETTINGS_ROW}`;
    toast.show({
      message: FIELD_REMOVED_TOAST,
      durationMs: UNDO_TOAST_MS,
      action: {
        label: "Undo",
        onClick: () => {
          setDraft((d) => sync(r.restore(d)));
          setSelectedId(fid);
        },
      },
    });
  }

  function patchForm(patch: Partial<FormDraft>) {
    setDraft((d) => ({ ...d, ...patch }));
    for (const k of Object.keys(patch)) {
      clearServerError(k === "after_submit" ? "after_submit" : k);
      if (k === "after_submit") clearServerError("button_text");
    }
  }

  function discard() {
    setDraft(saved);
    setServerErrors({});
    setSummary(null);
    setSaveError(null);
  }

  async function save() {
    if (!canSave(latest.current, saved, readOnly) || saving) return;
    const sent = latest.current;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await onSave(draftToInput(id, sent, { proActive }));
      if (!res.ok) {
        setSaveError(res.message || SAVE_FAILED_COPY);
        return;
      }
      if ("invalid" in res.data) {
        const errs = res.data.invalid.errors;
        setServerErrors({ ...errs });
        setSummary(formErrorsSummary(Object.keys(errs).length));
        const target = serverErrorTarget(errs, sent.fields);
        const isField =
          target !== null && sent.fields.some((f) => f.id === target);
        setSelectedId(isField ? target : SETTINGS_ROW);
        setPane("detail");
        setPreviewOpen(false);
        focusInvalid.current = true;
        return;
      }
      const { form: stored, held } = res.data.saved;
      const base =
        stored && typeof stored === "object" ? draftFromRecord(stored) : sent;
      const next: FormDraft = { ...base, inReview: held || base.inReview };
      setSaved(next);
      setDraft((current) => (isDirty(current, sent) ? current : next));
      setServerErrors({});
      setSummary(null);
      toast.show({ message: held ? HELD_TOAST : SAVED_TOAST });
    } catch {
      setSaveError(SAVE_FAILED_COPY);
    } finally {
      setSaving(false);
    }
  }

  function startRename() {
    setNameDraft(draft.name);
    setEditingName(true);
    focusNext.current = `${uid}-rename`;
  }

  function commitRename() {
    if (!editingName) return;
    setEditingName(false);
    patchForm({ name: nameDraft });
    focusNext.current = `${uid}-name-button`;
  }

  function onRenameKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditingName(false);
      focusNext.current = `${uid}-name-button`;
    }
  }

  const listVisible = pane === "list" && !previewOpen;
  const settingsVisible = pane === "detail" && !previewOpen;
  const paneTitle = selectedField ? "Field settings" : "Form settings";

  return (
    <div className="flex flex-col gap-4 font-hub" data-form-editor={id}>
      <header className="flex flex-col gap-3 border-b border-hub-border pb-4">
        <LinkComponent href={backHref} className={LINK}>
          <ArrowLeft aria-hidden size={16} strokeWidth={2} />
          Forms
        </LinkComponent>
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {editingName && !readOnly ? (
              <div className="flex max-w-md flex-col gap-1">
                <label htmlFor={`${uid}-rename`} className="sr-only">
                  Form name
                </label>
                <input
                  id={`${uid}-rename`}
                  value={nameDraft}
                  maxLength={80}
                  aria-describedby={`${uid}-rename-helper`}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={onRenameKey}
                  className="h-11 rounded border border-hub-border-strong bg-hub-surface px-3 text-2xl font-semibold text-hub-ink"
                />
                <p
                  id={`${uid}-rename-helper`}
                  className="text-sm text-hub-ink-muted"
                >
                  {NAME_HELPER}
                </p>
              </div>
            ) : (
              <h1 className="min-w-0">
                <button
                  type="button"
                  id={`${uid}-name-button`}
                  disabled={readOnly}
                  onClick={startRename}
                  aria-label={
                    readOnly
                      ? undefined
                      : `${draft.name || "Untitled form"}. Rename`
                  }
                  className={
                    "max-w-full truncate rounded text-left text-[1.75rem] leading-tight font-semibold " +
                    "text-hub-ink enabled:hover:underline focus-visible:outline-2 " +
                    "focus-visible:outline-offset-2 focus-visible:outline-hub-accent disabled:cursor-default"
                  }
                >
                  {draft.name || "Untitled form"}
                </button>
              </h1>
            )}
            {saved.inReview ? (
              <p className="text-sm font-semibold text-hub-warning">
                {IN_REVIEW}
              </p>
            ) : null}
            <p className="text-sm text-hub-ink-muted">
              {readOnly ? READ_ONLY_LINE : LIVE_NOTE}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              aria-pressed={previewOpen}
              icon={<Eye aria-hidden size={16} strokeWidth={2} />}
              onClick={() => setPreviewOpen((v) => !v)}
              className="xl:hidden"
            >
              Preview form
            </Button>
            {!readOnly && dirty ? (
              <Button variant="ghost" onClick={discard}>
                Discard changes
              </Button>
            ) : null}
            {readOnly ? null : (
              <Button
                variant="primary"
                disabled={!allowSave}
                loading={saving}
                loadingLabel="Saving…"
                onClick={() => void save()}
              >
                Save form
              </Button>
            )}
          </div>
        </div>
      </header>

      {summary ? <InlineAlert tone="error">{summary}</InlineAlert> : null}
      {saveError ? <InlineAlert tone="error">{saveError}</InlineAlert> : null}

      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,480px)_minmax(0,1fr)]">
        <div
          data-pane="list"
          className={`${listVisible ? "block" : "hidden"} lg:block rounded border border-hub-border bg-hub-surface-2`}
        >
          <FieldList
            fields={draft.fields}
            selectedId={selectedId}
            errors={errors}
            readOnly={readOnly}
            limitReached={limitReached}
            onSelect={select}
            onMove={onMove}
            onAdd={onAdd}
            rowIdPrefix={rowPrefix}
            entitlements={entitlements}
            canBuy={canBuy}
            LinkComponent={LinkComponent}
            steps={proActive ? draft.pro?.steps : undefined}
            ruleIds={
              proActive
                ? new Set((draft.pro?.rules ?? []).map((r) => r.target))
                : undefined
            }
          />
        </div>
        <div
          id={`${uid}-settings`}
          data-pane="settings"
          className={`${settingsVisible ? "block" : "hidden"} ${previewOpen ? "lg:hidden" : "lg:block"} xl:block min-w-0 max-w-[480px]`}
        >
          <Button
            variant="ghost"
            size="sm"
            icon={<ArrowLeft aria-hidden size={16} strokeWidth={2} />}
            onClick={() => setPane("list")}
            className="mb-4 lg:hidden"
          >
            Fields
          </Button>
          <fieldset disabled={readOnly} className="min-w-0">
            <legend className="sr-only">{paneTitle}</legend>
            {selectedField ? (
              <>
                <FieldSettingsPane
                  key={selectedField.id}
                  field={selectedField}
                  layout={draft.layout}
                  error={errors[selectedField.id]}
                  readOnly={readOnly}
                  idPrefix={fieldPrefix}
                  onChange={(patch) => patchField(selectedField.id, patch)}
                  onChangeType={(type) => onChangeType(selectedField.id, type)}
                  onRemove={() => onRemove(selectedField.id)}
                />
                <div className="mt-6">
                  <ProRulesEditor
                    key={`rule-${selectedField.id}`}
                    field={selectedField}
                    fields={draft.fields}
                    rule={ruleFor(draft, selectedField.id)}
                    onChange={(rule) => {
                      setDraft((d) => setRule(d, selectedField.id, rule));
                      clearServerError("pro.rules");
                    }}
                    locked={!proActive}
                    canBuy={canBuy}
                    idPrefix={`${fieldPrefix}-${selectedField.id}`}
                    LinkComponent={LinkComponent}
                  />
                </div>
              </>
            ) : (
              <>
                <FormSettingsPane
                  draft={draft}
                  errors={errors}
                  pages={pages}
                  routes={routes}
                  idPrefix={`${uid}-form`}
                  onChange={patchForm}
                  onExternalFormHelp={onExternalFormHelp}
                  LinkComponent={LinkComponent}
                />
                <ProSettingsPanel
                  pro={proOf(draft)}
                  fields={draft.fields}
                  routes={routes}
                  onChange={onProChange}
                  locked={!proActive}
                  paused={proPaused}
                  canBuy={canBuy}
                  errors={errors}
                  idPrefix={`${uid}-form`}
                  LinkComponent={LinkComponent}
                />
              </>
            )}
          </fieldset>
        </div>
        <div
          data-pane="preview"
          className={`${previewOpen ? "block" : "hidden"} xl:block min-w-0`}
        >
          <FormPreview
            id={id}
            draft={draft}
            theme={theme}
            proActive={proActive}
          />
        </div>
      </div>
    </div>
  );
}

/** Types the Add field menu offers (for tests and docs). */
export const ADDABLE_TYPES: readonly FormFieldType[] = FORM_FIELD_GROUPS.filter(
  (g) => !g.pro,
).flatMap((g) => g.types.map((t) => t.type));

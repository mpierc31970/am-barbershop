"use client";
// Per-type block form for the page builder (03-13; CONT-05, CONT-06, CONT-07; D183, D119,
// invariant 7; 03-UI-SPEC "SectionForm", "Interaction states" block save, "Validation";
// CONTEXT Area 2 settings note; donor admin/SectionForm.tsx L174-380).
//
// Explicit draft save: fields edit a local copy and Save block sends it through onSave.
// The one styling control is Background (Page color / Alternate color): tenants build
// within the theme, so no colour, padding or class field exists here. Columns blocks use
// ColumnsEditor, which saves each structural change immediately through the same onSave.
// Client checks are a convenience; the server validates and sanitizes (T-03-56).
//
// Leave guard: onDirtyChange tells the route when the form holds unsaved edits, so it can
// ask "Save changes to <Label> block?"; saveRef lets that dialog's Save and continue run
// this form's save. A beforeunload guard covers closing the tab.
//
// Add-on blocks (05-UI-SPEC "Builder integration"): the route passes the block's owning
// add-on and a renderAddonForm callback (this package never imports an add-on). An active
// add-on's block renders its injected form above Background; a block whose add-on is off
// shows an InlineAlert instead of the form (delete and hide stay available).
import { Check } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import type {
  BackgroundVariant,
  ColumnsContent,
  RowLayout,
} from "@cds/core/content";
import { isRowLayout } from "@cds/core/content";
import type { AddonBlockFormProps } from "../hub/addon-types";
import { Button } from "../hub/Button";
import { InlineAlert } from "../hub/feedback";
import { TextArea, TextField } from "../hub/fields";
import { RadioCardGroup } from "../hub/RadioCardGroup";
import { Switch } from "../hub/Switch";
import {
  SiteThemeScope,
  type SiteThemeScopeProps,
} from "../site/SiteThemeScope";
import type { PopupOption } from "./ColumnItemForm";
import { ColumnsEditor, type ColumnsEditorHandle } from "./ColumnsEditor";
import { MediaField } from "./MediaField";
import { BUILDER_BLOCKS_A } from "./blocks/group-a";
import { BUILDER_BLOCKS_B } from "./blocks/group-b";
import type { BuilderBlockEntry, CoreBlockEditorHandle } from "./blocks/types";
import { RichTextEditor } from "./RichTextEditor";
import { linesToList, listToLines } from "./editor-logic";
import {
  ERR_SAVE_COPY,
  attentionLine,
  blockFieldErrors,
  blockLabel,
  firstInvalidField,
  isDirty,
  normalizeBlockContent,
  type BuilderResult,
  type BuilderSaveInput,
  type BuilderSection,
  type LabelRegistry,
} from "./section-form-logic";

type SiteTheme = SiteThemeScopeProps["theme"];

export interface SectionFormProps {
  section: BuilderSection;
  /** The org's resolved theme ({ hash, css } from resolveTheme on the server). */
  theme: SiteTheme;
  popups: readonly PopupOption[];
  onSave: (input: BuilderSaveInput) => Promise<BuilderResult<BuilderSection>>;
  onDirtyChange: (dirty: boolean) => void;
  /** "Show on page" switch; the route runs the hide/show action. */
  onToggleHidden?: (hidden: boolean) => void;
  /** Called with the saved row after every successful save (header status, list). */
  onSaved?: (row: BuilderSection) => void;
  /** The leave-guard dialog calls this to save; resolves true when saved. */
  saveRef?: MutableRefObject<(() => Promise<boolean>) | null>;
  registry?: LabelRegistry;
  timeZone?: string;
  /** The add-on that owns this block type, when it is an add-on block. */
  addon?: SectionFormAddon | null;
  /** Renders an active add-on's block form (the route injects the registry's forms). */
  renderAddonForm?: (type: string, props: AddonBlockFormProps) => ReactNode;
  /** Delete this block (offered in the "add-on off" alert; the list menu has it too). */
  onDelete?: () => void;
}

export type SectionFormAddon = {
  slug: string;
  name: string;
  active: boolean;
};

/** Owner copy for a block whose add-on is off (05-UI-SPEC "Builder integration"). */
export function addonOffCopy(name: string): {
  lead: string;
  addBack: string;
  tail: string;
} {
  return {
    lead: `${name} is off, so this block doesn't show on your site. `,
    addBack: `Add ${name} back`,
    tail: " to show it again, or delete this block.",
  };
}

type Draft = Record<string, unknown>;

const SAVED_MS = 3000;
const LINK_HELPER = "A page on your site like /contact, or a full address.";
const ACCENT_HELPER = "Words shown in the accent color";

function asDraft(content: unknown): Draft {
  return typeof content === "object" &&
    content !== null &&
    !Array.isArray(content)
    ? { ...(content as Draft) }
    : {};
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function listOf(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}

/** Form order of every field, for "focus the first invalid field". */
const FIELD_ORDER: Readonly<Record<string, readonly string[]>> = {
  hero: [
    "heading",
    "heading_accent",
    "subtitle",
    "cta_primary_text",
    "cta_primary_link",
    "cta_secondary_text",
    "cta_secondary_link",
    "trust_text",
    "image_asset",
    "image_url",
    "image_alt",
  ],
  "text-image": [
    "heading",
    "text",
    "image_url",
    "image_alt",
    "quote",
    "list_items",
    "cta_text",
    "cta_link",
    "phone",
  ],
  "text-only": ["heading", "text"],
  "cta-banner": ["heading", "description", "button_text", "button_link"],
};

function Group({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-4">{children}</div>;
}

// The --site-* tokens exist only under [data-site], and the builder has no such ancestor,
// so each swatch brings its own SiteThemeScope (display: contents adds no box), the pattern
// BannerForm and PopupsTab use (WR-C09). P4: swatches paint the tenant theme (THEME-02,
// THEME-06 surface / surface-raised; 04-UI-SPEC "Theme in the hub"). The theme arrives
// precomputed from the server page as a prop; this package never reads the database. The
// 1px --hub-border-strong outline keeps a near-white surface visible on the white form
// (D-UI-P4-11). The scope only wraps the swatch, never the hub chrome around it.
function Swatch({
  variant,
  theme,
}: {
  variant: BackgroundVariant;
  theme: SiteTheme;
}) {
  return (
    <SiteThemeScope theme={theme} as="span" className="contents">
      <span
        aria-hidden
        data-swatch={variant}
        className={
          "block h-6 w-6 rounded border border-hub-border-strong " +
          (variant === "alternate"
            ? "bg-site-surface-raised"
            : "bg-site-surface")
        }
      />
    </SiteThemeScope>
  );
}

function coreBlockEntry(type: string): BuilderBlockEntry | undefined {
  const own = (o: object) => Object.prototype.hasOwnProperty.call(o, type);
  if (own(BUILDER_BLOCKS_A)) return BUILDER_BLOCKS_A[type];
  if (own(BUILDER_BLOCKS_B)) return BUILDER_BLOCKS_B[type];
  return undefined;
}

export function SectionForm({
  section,
  theme,
  popups,
  onSave,
  onDirtyChange,
  onToggleHidden,
  onSaved,
  saveRef,
  registry,
  timeZone,
  addon,
  renderAddonForm,
  onDelete,
}: SectionFormProps) {
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;
  const type = section.section_type;
  const label = blockLabel(type, registry);
  const isColumns = type === "columns";

  const [baseline, setBaseline] = useState(() => ({
    content: section.content,
    background: section.settings.background_variant,
    layout: section.row_layout,
  }));
  const [draft, setDraft] = useState<Draft>(() => asDraft(section.content));
  const [listText, setListText] = useState(() =>
    listToLines(listOf(asDraft(section.content).list_items)),
  );
  const [background, setBackground] = useState<BackgroundVariant>(
    section.settings.background_variant,
  );
  // The Background the owner last sent with Save block. Column commits send this, not
  // baseline.background: baseline only moves once Save block resolves, so a column commit
  // made while it is in flight would land after it and put the old Background back (WR-R01).
  const committedBackground = useRef<BackgroundVariant>(
    section.settings.background_variant,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(savedTimer.current), []);

  /** The content this form would save right now. */
  function currentContent(): unknown {
    if (isColumns) return baseline.content;
    const next: Draft = { ...draft };
    if (type === "text-image") next.list_items = linesToList(listText);
    return normalizeBlockContent(type, next);
  }

  const blockDirty = isDirty(
    { type, content: baseline.content, background: baseline.background },
    { content: currentContent(), background },
  );
  // Columns blocks: an open item form (or new-item draft) with edits counts too, so the
  // leave guard, beforeunload and Save block all see it (WR-C10).
  const [itemsDirty, setItemsDirty] = useState(false);
  // 07-20: group editors (slider, tabs) report open item forms the same way; only
  // editors that call onDirtyChange ever set itemsDirty.
  const dirty = blockDirty || itemsDirty;

  const columnsRef = useRef<ColumnsEditorHandle | null>(null);
  // 07-20: a group editor's handle (flush its open item form, read its newest fields).
  const blockEditorRef = useRef<CoreBlockEditorHandle | null>(null);

  const onDirtyRef = useRef(onDirtyChange);
  useEffect(() => {
    onDirtyRef.current = onDirtyChange;
  }, [onDirtyChange]);
  useEffect(() => {
    onDirtyRef.current(dirty);
  }, [dirty]);
  useEffect(() => () => onDirtyRef.current(false), []);

  useEffect(() => {
    if (!dirty) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  function flashSaved() {
    setSaved(true);
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), SAVED_MS);
  }

  function set(name: string, value: unknown) {
    setDraft((d) => ({ ...d, [name]: value }));
    if (errors[name]) {
      setErrors((e) => {
        const next = { ...e };
        delete next[name];
        return next;
      });
    }
  }

  async function save(): Promise<boolean> {
    // Columns: save any open item form first (it validates and shows its own errors), so
    // "Save block" and the leave dialog's "Save and continue" never drop typed item edits.
    if (isColumns && itemsDirty) {
      setSaving(true);
      const flushed = (await columnsRef.current?.flush()) ?? true;
      setSaving(false);
      if (!flushed) return false;
      if (!blockDirty) {
        flashSaved();
        return true;
      }
    }
    // Group editors (07-20): save the open slide/panel item form into the draft first.
    // Its flush only updates the draft, so Save block continues and persists it.
    if (!isColumns && itemsDirty && blockEditorRef.current) {
      setSaving(true);
      const flushed = await blockEditorRef.current.flush();
      setSaving(false);
      if (!flushed) return false;
    }
    // Columns: send the editor's live value. baseline only catches up after a column
    // commit resolves, so it could revert a reorder or item save still in flight, and
    // Server Actions run in order, so a stale Save block would land last (WR-C02).
    const live = isColumns ? (columnsRef.current?.latest() ?? null) : null;
    // Group editors: their newest fields win over a draft render that may lag (WR-C02).
    const groupLatest = isColumns
      ? null
      : (blockEditorRef.current?.latest() ?? null);
    const content = live
      ? live.content
      : groupLatest
        ? { ...(currentContent() as Record<string, unknown>), ...groupLatest }
        : currentContent();
    const layout = live ? live.layout : baseline.layout;
    const found = isColumns ? {} : blockFieldErrors(type, content);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      const first = firstInvalidField(FIELD_ORDER[type] ?? [], found);
      if (first) document.getElementById(fid(first))?.focus();
      return false;
    }
    setSaving(true);
    setSaveError(null);
    const confirmedBackground = baseline.background;
    committedBackground.current = background;
    try {
      const res = await onSave({
        id: section.id,
        pageId: section.page,
        section_type: type,
        row_layout: isRowLayout(layout) ? layout : "full",
        content,
        settings: { background_variant: background },
      });
      if (!res.ok) {
        committedBackground.current = confirmedBackground;
        setSaveError(res.message || ERR_SAVE_COPY);
        return false;
      }
      setBaseline({
        content,
        background,
        layout: res.data.row_layout,
      });
      flashSaved();
      onSaved?.(res.data);
      return true;
    } catch {
      committedBackground.current = confirmedBackground;
      setSaveError(ERR_SAVE_COPY);
      return false;
    } finally {
      setSaving(false);
    }
  }

  const saveFn = useRef(save);
  useEffect(() => {
    saveFn.current = save;
  });
  useEffect(() => {
    if (!saveRef) return;
    saveRef.current = () => saveFn.current();
    return () => {
      saveRef.current = null;
    };
  }, [saveRef]);

  function discard() {
    columnsRef.current?.discard();
    blockEditorRef.current?.discard();
    const base = asDraft(baseline.content);
    setDraft(base);
    setListText(listToLines(listOf(base.list_items)));
    setBackground(baseline.background);
    setErrors({});
    setSaveError(null);
  }

  /** ColumnsEditor saves structure immediately; a failure rejects so its view snaps back. */
  async function saveColumns(next: {
    layout: RowLayout;
    content: ColumnsContent;
  }): Promise<void> {
    const res = await onSave({
      id: section.id,
      pageId: section.page,
      section_type: type,
      row_layout: next.layout,
      content: next.content,
      settings: { background_variant: committedBackground.current },
    });
    if (!res.ok) throw new Error(res.message || ERR_SAVE_COPY);
    setBaseline((b) => ({
      ...b,
      content: res.data.content,
      layout: res.data.row_layout,
    }));
    onSaved?.(res.data);
  }

  function text(
    name: string,
    fieldLabel: string,
    opts: { helper?: string; type?: string; inputMode?: "tel" | "url" } = {},
  ) {
    return (
      <TextField
        id={fid(name)}
        label={fieldLabel}
        helper={opts.helper}
        error={errors[name]}
        type={opts.type}
        inputMode={opts.inputMode}
        value={str(draft[name])}
        onChange={(e) => set(name, e.currentTarget.value)}
      />
    );
  }

  function rich(name: string, fieldLabel: string) {
    return (
      <RichTextEditor
        id={fid(name)}
        label={fieldLabel}
        value={str(draft[name])}
        error={errors[name]}
        onChange={(html) => set(name, html)}
      />
    );
  }

  function imagePair(withLibrary = false) {
    return (
      <Group>
        {withLibrary ? (
          // P8 (R-3): the hero photo from the media library; it wins over the address
          // when it resolves. A pick fills an empty description with the library alt.
          <MediaField
            id={fid("image_asset")}
            label="Image"
            kind="image"
            value={str(draft.image_asset)}
            error={errors.image_asset}
            onChange={(picked) => {
              const p = picked[0];
              set("image_asset", p ? p.id : "");
              if (p && !str(draft.image_alt).trim() && p.alt) {
                set("image_alt", p.alt);
              }
            }}
          />
        ) : null}
        {text("image_url", "Image address", {
          type: "url",
          inputMode: "url",
          helper: "Starts with https://",
        })}
        {text("image_alt", "Image description", {
          helper: "Describe the image for people who can't see it.",
        })}
      </Group>
    );
  }

  let fields: ReactNode;
  switch (type) {
    case "hero":
      fields = (
        <>
          <Group>
            {text("heading", "Heading")}
            {text("heading_accent", "Heading accent", {
              helper: ACCENT_HELPER,
            })}
            {text("subtitle", "Subtitle")}
          </Group>
          <Group>
            {text("cta_primary_text", "Main button text")}
            {text("cta_primary_link", "Main button link", {
              helper: LINK_HELPER,
            })}
          </Group>
          <Group>
            {text("cta_secondary_text", "Second button text")}
            {text("cta_secondary_link", "Second button link", {
              helper: LINK_HELPER,
            })}
          </Group>
          <Group>
            {text("trust_text", "Trust line", {
              helper:
                "A short line under the buttons, like “Trusted by 200 families”.",
            })}
          </Group>
          {imagePair(true)}
        </>
      );
      break;
    case "text-image":
      fields = (
        <>
          <Group>
            {text("heading", "Heading")}
            {rich("text", "Text")}
          </Group>
          {imagePair()}
          <Group>
            {text("quote", "Quote")}
            <TextArea
              id={fid("list_items")}
              label="List items"
              helper="One item per line."
              error={errors.list_items}
              rows={4}
              value={listText}
              onChange={(e) => setListText(e.currentTarget.value)}
            />
          </Group>
          <Group>
            {text("cta_text", "Button text")}
            {text("cta_link", "Button link", { helper: LINK_HELPER })}
            {text("phone", "Phone", { type: "tel", inputMode: "tel" })}
          </Group>
        </>
      );
      break;
    case "text-only":
      fields = (
        <Group>
          {text("heading", "Heading")}
          {rich("text", "Text")}
        </Group>
      );
      break;
    case "cta-banner":
      fields = (
        <>
          <Group>
            {text("heading", "Heading")}
            <TextArea
              id={fid("description")}
              label="Description"
              error={errors.description}
              rows={3}
              value={str(draft.description)}
              onChange={(e) => set("description", e.currentTarget.value)}
            />
          </Group>
          <Group>
            {text("button_text", "Button text")}
            {text("button_link", "Button link", { helper: LINK_HELPER })}
          </Group>
        </>
      );
      break;
    case "columns":
      fields = (
        <ColumnsEditor
          layout={isRowLayout(baseline.layout) ? baseline.layout : "full"}
          content={baseline.content as ColumnsContent}
          popups={popups}
          onChange={saveColumns}
          timeZone={timeZone}
          handleRef={columnsRef}
          onDirtyChange={setItemsDirty}
        />
      );
      break;
    default: {
      // P7 core blocks (07-05): own-property lookups only, before the add-on fallthrough.
      const entry = coreBlockEntry(type);
      if (entry) {
        const Editor = entry.Editor;
        fields = (
          <Editor
            type={type}
            content={draft}
            onChange={set}
            errors={errors}
            popups={popups}
            timeZone={timeZone}
            onDirtyChange={setItemsDirty}
            handleRef={blockEditorRef}
          />
        );
        break;
      }
      const form =
        addon?.active && renderAddonForm
          ? renderAddonForm(type, {
              content: draft,
              onChange: set,
              errors,
              editHref: `/hub/website?tab=${encodeURIComponent(addon.slug)}`,
            })
          : null;
      fields = form ?? (
        <p className="text-base text-hub-ink-muted">
          This block is set up from its add-on. Its content has no fields to
          edit here.
        </p>
      );
    }
  }

  const attention = attentionLine(errors);

  if (addon && !addon.active) {
    const copy = addonOffCopy(addon.name);
    return (
      <section
        aria-labelledby={fid("title")}
        className="flex flex-col gap-6 font-hub"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2
            id={fid("title")}
            className="text-xl leading-tight font-semibold text-hub-ink"
          >
            {label} block
          </h2>
          <Switch
            id={fid("shown")}
            label="Show on page"
            checked={section.is_published}
            onChange={(checked) => onToggleHidden?.(!checked)}
          />
        </div>
        <InlineAlert
          tone="warning"
          action={
            onDelete ? (
              <Button variant="secondary" size="sm" onClick={onDelete}>
                Delete block
              </Button>
            ) : undefined
          }
        >
          {copy.lead}
          <a
            href={`/hub/add-ons/${encodeURIComponent(addon.slug)}`}
            className="font-semibold text-hub-accent underline underline-offset-2"
          >
            {copy.addBack}
          </a>
          {copy.tail}
        </InlineAlert>
      </section>
    );
  }

  return (
    <form
      noValidate
      aria-labelledby={fid("title")}
      className="flex flex-col gap-6 font-hub"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2
          id={fid("title")}
          className="text-xl leading-tight font-semibold text-hub-ink"
        >
          {label} block
        </h2>
        <Switch
          id={fid("shown")}
          label="Show on page"
          checked={section.is_published}
          onChange={(checked) => onToggleHidden?.(!checked)}
        />
      </div>

      {fields}

      <RadioCardGroup<BackgroundVariant>
        name={fid("background_variant")}
        legend="Background"
        value={background}
        onChange={setBackground}
        options={[
          {
            value: "main",
            title: "Page color",
            adornment: <Swatch variant="main" theme={theme} />,
          },
          {
            value: "alternate",
            title: "Alternate color",
            adornment: <Swatch variant="alternate" theme={theme} />,
          },
        ]}
      />

      <div className="sticky bottom-0 -mx-1 flex flex-col gap-3 border-t border-hub-border bg-hub-surface px-1 py-4">
        {saveError ? <InlineAlert tone="error">{saveError}</InlineAlert> : null}
        {attention ? (
          <p role="alert" className="text-sm font-semibold text-hub-danger">
            {attention}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            variant="primary"
            disabled={!dirty}
            loading={saving}
            loadingLabel="Saving…"
          >
            Save block
          </Button>
          {dirty && !saving ? (
            <Button variant="ghost" onClick={discard}>
              Discard changes
            </Button>
          ) : null}
          {saved && !dirty ? (
            <span className="inline-flex items-center gap-1 text-sm text-hub-success">
              <Check aria-hidden size={16} strokeWidth={2} />
              Saved
            </span>
          ) : null}
        </div>
      </div>
    </form>
  );
}

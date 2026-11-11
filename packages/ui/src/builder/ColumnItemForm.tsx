"use client";
// One column item's edit form (03-08; CONT-09, CONT-10, CONT-12; 03-UI-SPEC
// "ColumnItemForm fields", Copywriting; RESEARCH Pitfall 8; donor ColumnItemForm.tsx).
//
// One form per item kind. Field errors come from itemFieldErrors for instant feedback;
// the server re-validates everything on save (03-06), so this form shapes input, it is not
// the trust boundary. Countdown converts its datetime-local value to a UTC ISO instant
// here in the browser, from the shown time zone (T-03-31): the server never guesses one.
// A button can open a pop-up only where allowPopupButton is true (never inside a pop-up).
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { ColumnItem } from "@cds/core/content";
import { Button } from "../hub/Button";
import { TextArea, TextField, Select } from "../hub/fields";
import { RadioCardGroup } from "../hub/RadioCardGroup";
import { InlineAlert } from "../hub/feedback";
import { DELETED_POPUP_COPY } from "./deleted-refs";
import { RichTextEditor } from "./RichTextEditor";
import { AudioItemEditor } from "./items/AudioItemEditor";
import { EmbedItemEditor } from "./items/EmbedItemEditor";
import { FormItemEditor } from "./items/FormItemEditor";
import type { FormOption } from "./items/types";
import { VideoItemEditor } from "./items/VideoItemEditor";
import { MediaField } from "./MediaField";
import {
  browserTimeZone,
  itemFieldErrors,
  linesToList,
  listToLines,
  localInputToUtcIso,
  utcIsoToLocalInput,
} from "./editor-logic";

export interface PopupOption {
  id: string;
  name: string;
  /** Soft-deleted (07-28, D275): offered only while chosen, labelled "(deleted)". */
  deleted?: boolean;
}

/** Live pop-ups, plus the chosen one when it is soft-deleted (07-28 choice 9). */
function popupChoices(
  popups: readonly PopupOption[],
  chosen: string,
): readonly PopupOption[] {
  return popups.filter((p) => !p.deleted || p.id === chosen);
}

export interface ColumnItemFormProps {
  item: ColumnItem;
  popups: readonly PopupOption[];
  /** The site's forms for a Form item (07-18 supplies them; omitted = none yet). */
  forms?: readonly FormOption[];
  /** False inside a pop-up: its buttons may only follow links (CONT-12). */
  allowPopupButton: boolean;
  onSave: (item: ColumnItem) => Promise<void>;
  onCancel: () => void;
  /** IANA zone for the countdown field; defaults to the browser's. */
  timeZone?: string;
  /**
   * Told whether the form holds edits not yet saved (the block's leave guard counts
   * them, WR-C10). Reported false again when the form closes.
   */
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * Receives this form's "validate and save now" (resolves true when saved), so the
   * block's Save / leave dialog can save an open item form; null when the form closes.
   */
  registerSave?: (save: (() => Promise<boolean>) | null) => void;
}

const ERR_SAVE =
  "Your changes weren't saved. Try again; if it keeps failing, copy your text somewhere safe first.";

const POPUPS_HREF = "/hub/website?tab=popups";

type Errors = Record<string, string>;

/** The item the form would save, from its text-shaped field state. */
function assembleItem(
  draft: ColumnItem,
  listText: string,
  localTarget: string,
  zone: string,
): ColumnItem {
  if (draft.kind === "list") return { ...draft, items: linesToList(listText) };
  if (draft.kind === "countdown") {
    return { ...draft, target_at: localInputToUtcIso(localTarget, zone) };
  }
  if (draft.kind === "button" && draft.action === "link") {
    return { ...draft, popup_id: "" };
  }
  return draft;
}

export function ColumnItemForm({
  item,
  popups,
  forms,
  allowPopupButton,
  onSave,
  onCancel,
  timeZone,
  onDirtyChange,
  registerSave,
}: ColumnItemFormProps) {
  const uid = useId();
  const fid = (field: string) => `${uid}-${field}`;
  const [zone] = useState(() => timeZone ?? browserTimeZone());
  const [draft, setDraft] = useState<ColumnItem>(item);
  // Text-shaped mirrors, so typing never fights a parse (list lines, local time).
  const [listText, setListText] = useState(() =>
    item.kind === "list" ? listToLines(item.items) : "",
  );
  const [localTarget, setLocalTarget] = useState(() =>
    item.kind === "countdown" ? utcIsoToLocalInput(item.target_at, zone) : "",
  );
  const [errors, setErrors] = useState<Errors>({});
  // Image item: the address disclosure starts open for an item that already uses one.
  const [imageLinkOpen, setImageLinkOpen] = useState(
    () => item.kind === "image" && !item.asset && item.url.trim() !== "",
  );
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  // What the form held when it opened, in the same assembled shape it saves.
  const [initial] = useState(() =>
    JSON.stringify(
      assembleItem(
        item,
        item.kind === "list" ? listToLines(item.items) : "",
        item.kind === "countdown"
          ? utcIsoToLocalInput(item.target_at, zone)
          : "",
        zone,
      ),
    ),
  );

  // Narrowed patch: the draft always keeps the kind it started with.
  function patch(fields: Partial<ColumnItem>) {
    setDraft((d) => ({ ...d, ...fields }) as ColumnItem);
  }

  /** A patch typed to one kind, for the P7 item editors (the union is never widened). */
  function patchFor<I extends ColumnItem>(): (fields: Partial<I>) => void {
    return (fields) => patch(fields as Partial<ColumnItem>);
  }

  function assemble(): ColumnItem {
    return assembleItem(draft, listText, localTarget, zone);
  }

  const dirty = JSON.stringify(assemble()) !== initial;
  const onDirtyRef = useRef(onDirtyChange);
  const registerRef = useRef(registerSave);
  useEffect(() => {
    onDirtyRef.current = onDirtyChange;
    registerRef.current = registerSave;
  });
  useEffect(() => {
    onDirtyRef.current?.(dirty);
  }, [dirty]);
  useEffect(
    () => () => {
      onDirtyRef.current?.(false);
    },
    [],
  );

  /** Validate, then save. Resolves true when the item saved. */
  async function saveNow(): Promise<boolean> {
    const next = assemble();
    const found = itemFieldErrors(next, { allowPopupButton });
    setErrors(found);
    setSaveFailed(false);
    const first = Object.keys(found).find((k) => k !== "form");
    if (first) {
      document.getElementById(fid(first))?.focus();
      return false;
    }
    if (found.form) return false;
    setSaving(true);
    try {
      await onSave(next);
      return true;
    } catch {
      setSaveFailed(true);
      return false;
    } finally {
      setSaving(false);
    }
  }

  const saveNowRef = useRef(saveNow);
  useEffect(() => {
    saveNowRef.current = saveNow;
  });
  useEffect(() => {
    registerRef.current?.(() => saveNowRef.current());
    return () => registerRef.current?.(null);
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void saveNow();
  }

  return (
    <form
      noValidate
      onSubmit={submit}
      className="flex flex-col gap-4 border-t border-hub-border bg-hub-surface p-4 font-hub"
    >
      {fields()}

      {errors.form ? (
        <InlineAlert tone="error">{errors.form}</InlineAlert>
      ) : null}
      {saveFailed ? <InlineAlert tone="error">{ERR_SAVE}</InlineAlert> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          variant="primary"
          loading={saving}
          loadingLabel="Saving…"
        >
          Save item
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Discard changes
        </Button>
      </div>
    </form>
  );

  function fields() {
    switch (draft.kind) {
      case "heading":
        return (
          <>
            <TextField
              id={fid("text")}
              label="Heading"
              value={draft.text}
              error={errors.text}
              maxLength={500}
              onChange={(e) => patch({ text: e.target.value })}
            />
            <RadioCardGroup
              name={fid("level")}
              legend="Heading size"
              value={draft.level === 3 ? "3" : "2"}
              onChange={(v) => patch({ level: v === "3" ? 3 : 2 })}
              options={[
                { value: "2", title: "Section heading (H2)" },
                { value: "3", title: "Sub-heading (H3)" },
              ]}
            />
          </>
        );
      case "text":
        return (
          <RichTextEditor
            id={fid("html")}
            label="Text"
            value={draft.html}
            error={errors.html}
            onChange={(html) => patch({ html })}
          />
        );
      case "list":
        return (
          <TextArea
            id={fid("items")}
            label="List items"
            helper="One item per line."
            rows={5}
            value={listText}
            error={errors.items}
            onChange={(e) => setListText(e.target.value)}
          />
        );
      case "image":
        // 07-17 (CONT-14, D-UI-P7-5): the photo comes from the library through MediaField;
        // the link disclosure keeps the P3 address for stock photos. Picking a photo
        // clears the address; typing an address clears the photo.
        return (
          <>
            <MediaField
              id={fid("asset")}
              label="Photo"
              kind="image"
              allowStock
              value={draft.asset ?? ""}
              stockValue={
                draft.credit && draft.url
                  ? { url: draft.url, creditName: draft.credit.name }
                  : null
              }
              onChange={(picked) => {
                const p = picked[0];
                if (!p) {
                  patch({
                    asset: "",
                    ...(draft.credit ? { url: "" } : {}),
                    credit: undefined,
                  });
                  return;
                }
                if (p.stock) {
                  // 07-30 (CONT-28): a Free photos pick is stored by URL with its credit.
                  patch({
                    asset: "",
                    url: p.stock.url,
                    alt: p.alt,
                    credit: {
                      name: p.stock.creditName,
                      url: p.stock.creditUrl,
                      source: p.stock.source,
                    },
                  });
                  return;
                }
                // A different photo takes its own description (WR-E04); a typed one
                // is kept only for the first pick or the same photo.
                const replaced =
                  p.id !== draft.asset && Boolean(draft.asset || draft.url);
                patch({
                  asset: p.id,
                  url: "",
                  alt: replaced || !draft.alt.trim() ? p.alt : draft.alt,
                  credit: undefined,
                });
              }}
            />
            <TextField
              id={fid("alt")}
              label="Description"
              helper="Describe the photo for people who can't see it."
              required
              value={draft.alt}
              error={errors.alt}
              maxLength={500}
              onChange={(e) => patch({ alt: e.target.value })}
            />
            <details
              open={imageLinkOpen}
              onToggle={(e) => setImageLinkOpen(e.currentTarget.open)}
              className="flex flex-col gap-2"
            >
              <summary className="cursor-pointer rounded text-sm font-semibold text-hub-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent">
                Paste a link instead
              </summary>
              <div className="pt-2">
                <TextField
                  id={fid("url")}
                  label="Image address"
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  value={draft.url}
                  error={errors.url}
                  onChange={(e) =>
                    patch({ url: e.target.value, asset: "", credit: undefined })
                  }
                />
              </div>
            </details>
          </>
        );
      case "button":
        return buttonFields(draft);
      case "countdown":
        return (
          <>
            <TextField
              id={fid("target_at")}
              label="Counts down to"
              type="datetime-local"
              helper={`Your time zone: ${zone}`}
              value={localTarget}
              error={errors.target_at}
              onChange={(e) => setLocalTarget(e.target.value)}
              className="tabular-nums"
            />
            <TextField
              id={fid("zero_message")}
              label="Message when it reaches zero"
              placeholder="Doors are open."
              value={draft.zero_message}
              error={errors.zero_message}
              maxLength={500}
              required
              onChange={(e) => patch({ zero_message: e.target.value })}
            />
          </>
        );
      case "spacer":
        return (
          <RadioCardGroup
            name={fid("height")}
            legend="Space"
            value={draft.height}
            onChange={(height) => patch({ height })}
            options={[
              { value: "sm", title: "Small", description: "24px" },
              { value: "md", title: "Medium", description: "48px" },
              { value: "lg", title: "Large", description: "64px" },
            ]}
          />
        );
      case "divider":
        return (
          <p className="text-sm text-hub-ink-muted">
            A divider draws a thin line across the column. It has no settings.
          </p>
        );
      // P7 kinds (07-08): each editor lives in ./items/.
      case "video":
        return (
          <VideoItemEditor
            draft={draft}
            patch={patchFor<typeof draft>()}
            errors={errors}
            fid={fid}
          />
        );
      case "audio":
        return (
          <AudioItemEditor
            draft={draft}
            patch={patchFor<typeof draft>()}
            errors={errors}
            fid={fid}
          />
        );
      case "embed":
        return (
          <EmbedItemEditor
            draft={draft}
            patch={patchFor<typeof draft>()}
            errors={errors}
            fid={fid}
          />
        );
      case "form":
        return (
          <FormItemEditor
            draft={draft}
            patch={patchFor<typeof draft>()}
            errors={errors}
            fid={fid}
            forms={forms}
          />
        );
    }
  }

  function buttonFields(b: Extract<ColumnItem, { kind: "button" }>) {
    const actionOptions = allowPopupButton
      ? [
          { value: "link" as const, title: "Go to a link" },
          { value: "popup" as const, title: "Open a pop-up" },
        ]
      : [{ value: "link" as const, title: "Go to a link" }];
    return (
      <>
        <TextField
          id={fid("text")}
          label="Button text"
          value={b.text}
          error={errors.text}
          maxLength={500}
          onChange={(e) => patch({ text: e.target.value })}
        />
        <RadioCardGroup
          name={fid("style")}
          legend="Style"
          value={b.style}
          onChange={(style) => patch({ style })}
          options={[
            { value: "primary", title: "Primary", description: "Filled" },
            { value: "secondary", title: "Secondary", description: "Outlined" },
          ]}
        />
        <div id={fid("action")} tabIndex={-1} className="flex flex-col gap-2">
          <RadioCardGroup
            name={fid("action-choice")}
            legend="When someone clicks it"
            value={b.action}
            onChange={(action) => patch({ action })}
            options={actionOptions}
          />
          {errors.action ? (
            <p className="text-sm text-hub-danger">{errors.action}</p>
          ) : null}
        </div>
        {b.action === "link" ? (
          <TextField
            id={fid("link")}
            label="Link"
            helper="A page path like /about, or a full address like https://example.com."
            placeholder="/about"
            value={b.link}
            error={errors.link}
            onChange={(e) => patch({ link: e.target.value })}
          />
        ) : popupChoices(popups, b.popup_id).length === 0 ? (
          <div
            id={fid("popup_id")}
            tabIndex={-1}
            className="flex flex-col gap-1 text-sm"
          >
            <p className="text-hub-ink-muted">This site has no pop-ups yet.</p>
            <a
              href={POPUPS_HREF}
              className="font-semibold text-hub-accent underline underline-offset-2"
            >
              Create a pop-up first
            </a>
            {errors.popup_id ? (
              <p className="text-hub-danger">{errors.popup_id}</p>
            ) : null}
          </div>
        ) : (
          <>
            <Select
              id={fid("popup_id")}
              label="Pop-up"
              value={b.popup_id}
              error={errors.popup_id}
              onChange={(e) => patch({ popup_id: e.target.value })}
              options={[
                { value: "", label: "Choose a pop-up" },
                ...popupChoices(popups, b.popup_id).map((p) => ({
                  value: p.id,
                  label: p.deleted ? `${p.name} (deleted)` : p.name,
                })),
              ]}
            />
            {popups.some((p) => p.id === b.popup_id && p.deleted) ? (
              <InlineAlert
                tone="info"
                action={
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      document.getElementById(fid("popup_id"))?.focus()
                    }
                  >
                    Choose another
                  </Button>
                }
              >
                {DELETED_POPUP_COPY}
              </InlineAlert>
            ) : null}
          </>
        )}
      </>
    );
  }
}

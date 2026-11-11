"use client";
// Testimonial edit drawer (05-UI-SPEC "Testimonials tab > Edit drawer"; D-UI-P5-4; P3
// leave guard). Right Drawer, 480px. Fields and helpers exactly per the spec table, a live
// "N / 1,000" counter, Save testimonial (disabled until dirty), Discard changes when dirty,
// and the "Save changes to this testimonial?" guard on a dirty close. The server repeats
// every check (addonRepo runs records.validate), so these are a courtesy.
import {
  Button,
  Dialog,
  Drawer,
  IconButton,
  InlineAlert,
  Select,
  Switch,
  TextArea,
  TextField,
  type AddonRecordView,
  type HubActionResult,
} from "@cds/ui/hub";
import { X } from "lucide-react";
import { useId, useRef, useState } from "react";
import {
  COPY,
  DETAIL_MAX,
  NAME_MAX,
  PHOTO_ALT_MAX,
  QUOTE_MAX,
  parsePhotoUrl,
} from "../records";
import { DRAWER, ERR_SAVE } from "./copy";

export type TestimonialForm = {
  quote: string;
  author_name: string;
  author_detail: string;
  rating: string;
  photo_url: string;
  photo_alt: string;
  featured: boolean;
  is_published: boolean;
};

type FieldKey = keyof TestimonialForm;
type Errors = Partial<Record<FieldKey, string>>;

const s = (v: unknown) => (typeof v === "string" ? v : "");

export function formOf(record: AddonRecordView | null): TestimonialForm {
  const v = record?.values ?? {};
  const r = v.rating;
  return {
    quote: s(v.quote),
    author_name: s(v.author_name),
    author_detail: s(v.author_detail),
    rating:
      typeof r === "number" && Number.isInteger(r) && r >= 1 && r <= 5
        ? String(r)
        : "",
    photo_url: s(v.photo_url),
    photo_alt: s(v.photo_alt),
    featured: v.featured === true,
    is_published: record ? v.is_published !== false : true,
  };
}

/** Field errors with the same owner copy the server uses. */
export function formErrors(f: TestimonialForm): Errors {
  const e: Errors = {};
  const quote = f.quote.trim();
  if (quote === "") e.quote = COPY.quoteEmpty;
  else if (quote.length > QUOTE_MAX) e.quote = COPY.quoteLong;
  const name = f.author_name.trim();
  if (name === "") e.author_name = COPY.nameEmpty;
  else if (name.length > NAME_MAX) e.author_name = COPY.nameLong;
  if (f.author_detail.trim().length > DETAIL_MAX) {
    e.author_detail = COPY.detailLong;
  }
  let hasPhoto = false;
  try {
    hasPhoto = parsePhotoUrl(f.photo_url) !== "";
  } catch (err) {
    e.photo_url = err instanceof Error ? err.message : COPY.photoUrl;
  }
  const alt = f.photo_alt.trim();
  if (alt.length > PHOTO_ALT_MAX) e.photo_alt = COPY.photoAltLong;
  else if (hasPhoto && alt === "") e.photo_alt = COPY.photoAlt;
  return e;
}

/** The save payload: typed values, the record id when editing, the kept source. */
export function toInput(
  f: TestimonialForm,
  record: AddonRecordView | null,
): Record<string, unknown> {
  const source = record ? s(record.values.source) || "manual" : "manual";
  return {
    ...(record ? { id: record.id } : {}),
    quote: f.quote.trim(),
    author_name: f.author_name.trim(),
    author_detail: f.author_detail.trim(),
    rating: f.rating === "" ? null : Number(f.rating),
    photo_url: f.photo_url.trim(),
    photo_alt: f.photo_alt.trim(),
    source,
    featured: f.featured,
    is_published: f.is_published,
  };
}

const RATING_OPTIONS = [
  { value: "", label: DRAWER.noRating },
  ...[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: DRAWER.stars(n) })),
];

const FIELD_ORDER: readonly FieldKey[] = [
  "quote",
  "author_name",
  "author_detail",
  "photo_url",
  "photo_alt",
];

export interface TestimonialDrawerProps {
  open: boolean;
  /** null while adding a new testimonial. */
  record: AddonRecordView | null;
  onSave: (
    input: Record<string, unknown>,
  ) => Promise<HubActionResult<{ id: string; held: boolean }>>;
  /** After a successful save; the drawer is closed by the parent. */
  onSaved: (result: { id: string; held: boolean }) => void;
  onClose: () => void;
}

export function TestimonialDrawer({
  open,
  record,
  onSave,
  onSaved,
  onClose,
}: TestimonialDrawerProps) {
  const uid = useId();
  const initial = formOf(record);
  const [form, setForm] = useState<TestimonialForm>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [guard, setGuard] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // The parent mounts one drawer per opening, keyed by record id, so the form starts from
  // the record and a refreshed list never resets what the owner is typing.
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const id = (k: string) => `${uid}-${k}`;

  function set<K extends FieldKey>(key: K, value: TestimonialForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function focusFirst(errs: Errors) {
    const first = FIELD_ORDER.find((k) => errs[k]);
    if (!first) return;
    const el = bodyRef.current?.ownerDocument.getElementById(id(first));
    el?.focus();
  }

  async function save(): Promise<boolean> {
    const errs = formErrors(form);
    if (Object.values(errs).some(Boolean)) {
      setErrors(errs);
      focusFirst(errs);
      return false;
    }
    setSaving(true);
    setFailure(null);
    const res = await onSave(toInput(form, record)).catch(() => null);
    setSaving(false);
    if (!res) {
      setFailure(ERR_SAVE);
      return false;
    }
    if (!res.ok) {
      const field = res.field;
      if (field && (FIELD_ORDER as readonly string[]).includes(field)) {
        const next = { [field]: res.message } as Errors;
        setErrors(next);
        focusFirst(next);
      } else {
        setFailure(res.message || ERR_SAVE);
      }
      return false;
    }
    onSaved(res.data);
    return true;
  }

  function requestClose() {
    if (saving) return;
    if (dirty) setGuard(true);
    else onClose();
  }

  const errorCount = Object.values(errors).filter(Boolean).length;
  const titleText = record ? DRAWER.editTitle : DRAWER.newTitle;

  return (
    <>
      <Drawer open={open} onClose={requestClose} label={titleText} side="right">
        <div className="flex min-h-full flex-col font-hub text-hub-ink">
          <div className="flex items-center justify-between gap-2 border-b border-hub-border px-6 py-4">
            <h2 className="text-xl leading-tight font-semibold">{titleText}</h2>
            <IconButton
              label={DRAWER.close}
              tooltipAlign="end"
              onClick={requestClose}
              icon={<X aria-hidden size={20} strokeWidth={2} />}
            />
          </div>
          <div ref={bodyRef} className="flex flex-1 flex-col gap-6 px-6 py-6">
            {errorCount > 0 ? (
              <p role="alert" className="text-sm font-semibold text-hub-danger">
                {DRAWER.needsAttention(errorCount)}
              </p>
            ) : null}
            <TextArea
              id={id("quote")}
              label={DRAWER.quote}
              rows={6}
              value={form.quote}
              required
              error={errors.quote}
              counter={{ value: form.quote.length, max: QUOTE_MAX }}
              onChange={(e) => set("quote", e.target.value)}
            />
            <TextField
              id={id("author_name")}
              label={DRAWER.name}
              value={form.author_name}
              required
              maxLength={NAME_MAX}
              helper={DRAWER.nameHelper}
              error={errors.author_name}
              onChange={(e) => set("author_name", e.target.value)}
            />
            <TextField
              id={id("author_detail")}
              label={DRAWER.about}
              value={form.author_detail}
              maxLength={DETAIL_MAX}
              helper={DRAWER.aboutHelper}
              error={errors.author_detail}
              onChange={(e) => set("author_detail", e.target.value)}
            />
            <Select
              id={id("rating")}
              label={DRAWER.rating}
              value={form.rating}
              options={RATING_OPTIONS}
              onChange={(e) => set("rating", e.target.value)}
            />
            <TextField
              id={id("photo_url")}
              label={DRAWER.photo}
              type="url"
              inputMode="url"
              value={form.photo_url}
              helper={DRAWER.photoHelper}
              error={errors.photo_url}
              onChange={(e) => set("photo_url", e.target.value)}
            />
            <TextField
              id={id("photo_alt")}
              label={DRAWER.photoAlt}
              value={form.photo_alt}
              maxLength={PHOTO_ALT_MAX}
              helper={DRAWER.photoAltHelper}
              error={errors.photo_alt}
              onChange={(e) => set("photo_alt", e.target.value)}
            />
            <div className="flex flex-col gap-1">
              <Switch
                id={id("featured")}
                label={DRAWER.featured}
                checked={form.featured}
                aria-describedby={id("featured-help")}
                onChange={(v) => set("featured", v)}
              />
              <p
                id={id("featured-help")}
                className="text-sm text-hub-ink-muted"
              >
                {DRAWER.featuredHelper}
              </p>
            </div>
            <Switch
              id={id("is_published")}
              label={DRAWER.showOnSite}
              checked={form.is_published}
              onChange={(v) => set("is_published", v)}
            />
          </div>
          <div className="sticky bottom-0 flex flex-col gap-3 border-t border-hub-border bg-hub-surface px-6 py-4">
            {failure ? <InlineAlert tone="error">{failure}</InlineAlert> : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                disabled={!dirty}
                loading={saving}
                loadingLabel={DRAWER.saving}
                onClick={() => void save()}
              >
                {DRAWER.save}
              </Button>
              {dirty ? (
                <Button
                  variant="ghost"
                  disabled={saving}
                  onClick={() => {
                    setForm(formOf(record));
                    setErrors({});
                    setFailure(null);
                  }}
                >
                  {DRAWER.discard}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </Drawer>
      <Dialog
        open={guard}
        onClose={() => setGuard(false)}
        title={DRAWER.guardTitle}
        footer={
          <>
            <Button
              variant="primary"
              loading={saving}
              loadingLabel={DRAWER.saving}
              onClick={() => {
                setGuard(false);
                void save();
              }}
            >
              {DRAWER.guardSave}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setGuard(false);
                onClose();
              }}
            >
              {DRAWER.guardDiscard}
            </Button>
            <Button variant="ghost" autoFocus onClick={() => setGuard(false)}>
              {DRAWER.guardKeep}
            </Button>
          </>
        }
      >
        <p>{DRAWER.guardBody}</p>
      </Dialog>
    </>
  );
}

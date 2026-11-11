"use client";
// Credential edit drawer (05-UI-SPEC "Credentials tab > Drawer"; D-UI-P5-14, D-UI-P5-16; P3
// leave guard). Right Drawer, 480px. Title, Issued by, Group (free text with a <datalist> of
// the groups already in use), Number + "Show number on site" (off by default), Issued,
// Expires, Verify link, Show on site. Save credential (disabled until dirty), Discard
// changes when dirty, and the "Save changes to this credential?" guard on a dirty close.
// The server repeats every check (addonRepo runs records.validate), so these are a courtesy.
import {
  Button,
  Dialog,
  Drawer,
  IconButton,
  InlineAlert,
  Switch,
  TextField,
  type AddonRecordView,
  type HubActionResult,
} from "@cds/ui/hub";
import { X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { dayOf } from "../expiry";
import {
  CATEGORY_MAX,
  COPY,
  ISSUER_MAX,
  NUMBER_MAX,
  TITLE_MAX,
  parseDate,
  parseVerifyUrl,
} from "../records";
import { DRAWER, ERR_SAVE } from "./copy";

export type CredentialForm = {
  title: string;
  issuer: string;
  category: string;
  credential_number: string;
  show_number: boolean;
  issued_on: string;
  expires_on: string;
  verify_url: string;
  is_published: boolean;
};

type FieldKey = keyof CredentialForm;
type Errors = Partial<Record<FieldKey, string>>;

const s = (v: unknown) => (typeof v === "string" ? v : "");

export function formOf(record: AddonRecordView | null): CredentialForm {
  const v = record?.values ?? {};
  return {
    title: s(v.title),
    issuer: s(v.issuer),
    category: s(v.category),
    credential_number: s(v.credential_number),
    show_number: v.show_number === true,
    issued_on: dayOf(v.issued_on),
    expires_on: dayOf(v.expires_on),
    verify_url: s(v.verify_url),
    is_published: record ? v.is_published !== false : true,
  };
}

function thrown(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** Field errors with the same owner copy the server uses. */
export function formErrors(f: CredentialForm): Errors {
  const e: Errors = {};
  const title = f.title.trim();
  if (title === "") e.title = COPY.titleEmpty;
  else if (title.length > TITLE_MAX) e.title = COPY.titleLong;
  const issuer = f.issuer.trim();
  if (issuer === "") e.issuer = COPY.issuerEmpty;
  else if (issuer.length > ISSUER_MAX) e.issuer = COPY.issuerLong;
  if (f.category.trim().length > CATEGORY_MAX) e.category = COPY.categoryLong;
  if (f.credential_number.trim().length > NUMBER_MAX) {
    e.credential_number = COPY.numberLong;
  }
  let issued = "";
  let expires = "";
  try {
    issued = parseDate(f.issued_on, COPY.issuedDate);
  } catch (err) {
    e.issued_on = thrown(err, COPY.issuedDate);
  }
  try {
    expires = parseDate(f.expires_on, COPY.expiresDate);
  } catch (err) {
    e.expires_on = thrown(err, COPY.expiresDate);
  }
  if (issued !== "" && expires !== "" && expires < issued) {
    e.expires_on = COPY.expiresBeforeIssued;
  }
  try {
    parseVerifyUrl(f.verify_url);
  } catch (err) {
    e.verify_url = thrown(err, COPY.verifyUrl);
  }
  return e;
}

/** The save payload: typed values plus the record id when editing. */
export function toInput(
  f: CredentialForm,
  record: AddonRecordView | null,
): Record<string, unknown> {
  return {
    ...(record ? { id: record.id } : {}),
    title: f.title.trim(),
    issuer: f.issuer.trim(),
    category: f.category.trim(),
    credential_number: f.credential_number.trim(),
    show_number: f.show_number,
    issued_on: f.issued_on.trim(),
    expires_on: f.expires_on.trim(),
    verify_url: f.verify_url.trim(),
    is_published: f.is_published,
  };
}

const FIELD_ORDER: readonly FieldKey[] = [
  "title",
  "issuer",
  "category",
  "credential_number",
  "issued_on",
  "expires_on",
  "verify_url",
];

export interface CredentialDrawerProps {
  open: boolean;
  /** null while adding a new credential. */
  record: AddonRecordView | null;
  /** Groups already in use, offered as suggestions (D-UI-P5-16). */
  groups: readonly string[];
  onSave: (
    input: Record<string, unknown>,
  ) => Promise<HubActionResult<{ id: string; held: boolean }>>;
  /** After a successful save; the drawer is closed by the parent. */
  onSaved: (result: { id: string; held: boolean }) => void;
  onClose: () => void;
}

export function CredentialDrawer({
  open,
  record,
  groups,
  onSave,
  onSaved,
  onClose,
}: CredentialDrawerProps) {
  const uid = useId();
  const initial = formOf(record);
  const [form, setForm] = useState<CredentialForm>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [guard, setGuard] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // The parent mounts one drawer per opening, keyed by record id, so the form starts from
  // the record and a refreshed list never resets what the owner is typing.
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const id = (k: string) => `${uid}-${k}`;

  function set<K extends FieldKey>(key: K, value: CredentialForm[K]) {
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
  const listId = id("groups");
  const suggestions = [...new Set(groups.map((g) => g.trim()))].filter(
    (g) => g !== "",
  );

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
            <TextField
              id={id("title")}
              label={DRAWER.title}
              value={form.title}
              required
              maxLength={TITLE_MAX}
              helper={DRAWER.titleHelper}
              error={errors.title}
              onChange={(e) => set("title", e.target.value)}
            />
            <TextField
              id={id("issuer")}
              label={DRAWER.issuer}
              value={form.issuer}
              required
              maxLength={ISSUER_MAX}
              helper={DRAWER.issuerHelper}
              error={errors.issuer}
              onChange={(e) => set("issuer", e.target.value)}
            />
            <TextField
              id={id("category")}
              label={DRAWER.group}
              value={form.category}
              maxLength={CATEGORY_MAX}
              list={listId}
              autoComplete="off"
              helper={DRAWER.groupHelper}
              error={errors.category}
              onChange={(e) => set("category", e.target.value)}
            />
            <datalist id={listId}>
              {suggestions.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
            <div className="flex flex-col gap-3">
              <TextField
                id={id("credential_number")}
                label={DRAWER.number}
                value={form.credential_number}
                maxLength={NUMBER_MAX}
                error={errors.credential_number}
                onChange={(e) => set("credential_number", e.target.value)}
              />
              <Switch
                id={id("show_number")}
                label={DRAWER.showNumber}
                checked={form.show_number}
                onChange={(v) => set("show_number", v)}
              />
            </div>
            <TextField
              id={id("issued_on")}
              label={DRAWER.issued}
              type="date"
              value={form.issued_on}
              error={errors.issued_on}
              onChange={(e) => set("issued_on", e.target.value)}
            />
            <TextField
              id={id("expires_on")}
              label={DRAWER.expires}
              type="date"
              value={form.expires_on}
              helper={DRAWER.expiresHelper}
              error={errors.expires_on}
              onChange={(e) => set("expires_on", e.target.value)}
            />
            <TextField
              id={id("verify_url")}
              label={DRAWER.verify}
              type="url"
              inputMode="url"
              value={form.verify_url}
              helper={DRAWER.verifyHelper}
              error={errors.verify_url}
              onChange={(e) => set("verify_url", e.target.value)}
            />
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

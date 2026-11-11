"use client";
// Add-on proof in "People & proof" (06-20; 06-UI-SPEC "5 · People & proof"; CONTEXT A3-Q5;
// D-UI-P6-18, D-UI-P6-31; invariant 3). For a picked add-on with a manifest intake
// contribution: its setup questions (rendered from manifest.intake.fields, same field chrome,
// each saved on blur or change), and its records step in intake mode:
//   - "Paste or import your testimonials" opens the P5 CsvImportDialog wired to the add-on
//     intake actions (rows are held on the setup record, never written to the add-on's
//     collections: nothing is installed yet)
//   - "Add one by one" opens a drawer with the add-on's spreadsheet columns as fields
//     (label, example as the hint); the chokepoint validates with the add-on's own rules
//   - a count line "12 testimonials ready for your site", and the held rows with Edit and
//     Remove (immediate, with Undo back at the same place). Rows are addressed by their
//     stable key, never by position (B-WR-08), so a list changed elsewhere never makes
//     Edit or Remove hit the wrong row.
// A proof add-on the owner didn't pick is one line linking to its /hub/add-ons/<slug> page.
import type { AddonIntakeField } from "@cds/core/addons";
import {
  Button,
  CsvImportDialog,
  Drawer,
  IconButton,
  InlineAlert,
  Switch,
  TextArea,
  TextField,
  useToast,
  type ImportCommitResult,
} from "@cds/ui/hub";
import { Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import type {
  AddonProofView,
  ProofColumn,
  ProofOffer,
} from "../../../../lib/intake";
import {
  commitAddonIntakeImportAction,
  previewAddonIntakeImportAction,
  removeAddonIntakeRecordAction,
  saveAddonIntakeFieldsAction,
  saveAddonIntakeRecordAction,
  templateAddonIntakeCsvAction,
} from "../../../actions/addon-intake";
import { download } from "./list-helpers";
import { useStageAutosave } from "../setup/[stage]/StageFrame";
import { OPTIONAL } from "./BusinessInfoFields";

/** The lead-in per proof add-on; others get only "Add {name} to show them." */
export const PROOF_PHRASES: Readonly<Record<string, string>> = {
  testimonials: "Have reviews from customers?",
  credentials: "Have licenses, certifications or awards?",
};

export function readyLine(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural} ready for your site`;
}

const cap = (s: string) => (s ? `${s[0]!.toUpperCase()}${s.slice(1)}` : s);

/** "Have reviews from customers? Add Testimonials to show them." */
export function ProofOfferLine({ offer }: { offer: ProofOffer }) {
  const lead = Object.hasOwn(PROOF_PHRASES, offer.slug)
    ? PROOF_PHRASES[offer.slug]
    : null;
  return (
    <p className="text-sm text-hub-ink-muted">
      {lead ? `${lead} ` : ""}
      <Link
        href={`/hub/add-ons/${encodeURIComponent(offer.slug)}`}
        className="font-semibold text-hub-accent underline underline-offset-2"
      >
        Add {offer.name}
      </Link>{" "}
      to show them.
    </p>
  );
}

type Row = AddonProofView["records"][number];

/** A readable name for a row saved here, until the refreshed list brings the real title. */
function localTitle(
  columns: readonly ProofColumn[],
  v: Record<string, string>,
) {
  const named = columns.find((c) => /name|title/i.test(c.key) && v[c.key]);
  const first = columns.find((c) => v[c.key]?.trim());
  return (named ? v[named.key] : first ? v[first.key] : "") ?? "";
}

function IntakeField({
  slug,
  field,
  initial,
  readOnly,
  onSaved,
}: {
  slug: string;
  field: AddonIntakeField;
  initial: string | boolean;
  readOnly: boolean;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(initial);
  const last = useRef(JSON.stringify(initial));
  const auto = useStageAutosave<Record<string, unknown>>(
    `addon.${slug}.${field.id}`,
    async (v) => {
      const res = await saveAddonIntakeFieldsAction(slug, v);
      if (res.ok) onSaved();
      return res;
    },
  );
  const error = auto.status === "invalid" ? auto.failure?.message : undefined;
  const id = `field-addon-${slug}-${field.id}`;
  const helper = `${field.helper} ${field.fallback}`.trim();
  function save(v: string | boolean) {
    const k = JSON.stringify(v);
    if (
      k === last.current &&
      auto.status !== "invalid" &&
      auto.status !== "error"
    ) {
      return;
    }
    last.current = k;
    auto.run({ [field.id]: v });
  }

  if (field.kind === "switch") {
    return (
      <div className="flex flex-col gap-1">
        <Switch
          id={id}
          label={field.label}
          checked={value === true}
          disabled={readOnly}
          onChange={(v) => {
            setValue(v);
            save(v);
          }}
        />
        <p className="text-sm text-hub-ink-muted">{helper}</p>
        {error ? <p className="text-sm text-hub-danger">{error}</p> : null}
      </div>
    );
  }
  const text = typeof value === "string" ? value : "";
  const common = {
    id,
    label: field.label,
    labelExtra: OPTIONAL,
    helper,
    value: text,
    disabled: readOnly,
    error,
    ...(field.max ? { counter: { value: text.length, max: field.max } } : {}),
  };
  return field.kind === "textarea" ? (
    <TextArea
      {...common}
      rows={4}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => save(text.trim())}
    />
  ) : (
    <TextField
      {...common}
      type={field.kind === "url" ? "url" : "text"}
      inputMode={field.kind === "url" ? "url" : undefined}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => save(text.trim())}
    />
  );
}

function RecordDrawer({
  view,
  row,
  onSaved,
  onClose,
}: {
  view: AddonProofView;
  row: Row | null;
  onSaved: (row: Row, count: number) => void;
  onClose: () => void;
}) {
  const uid = useId();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      view.columns.map((c) => [c.key, row?.values[c.key] ?? ""]),
    ),
  );
  const [failure, setFailure] = useState<string | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const title = row ? `Edit ${view.singular}` : `New ${view.singular}`;

  async function save() {
    const gap = view.columns.find((c) => c.required && !values[c.key]?.trim());
    if (gap) {
      setMissing(gap.key);
      document.getElementById(`${uid}-${gap.key}`)?.focus();
      return;
    }
    setMissing(null);
    setSaving(true);
    setFailure(null);
    const res = await saveAddonIntakeRecordAction(
      view.slug,
      values,
      row?.key,
    ).catch(() => null);
    setSaving(false);
    if (!res || !res.ok) {
      setFailure(
        res && !res.ok
          ? res.message
          : "Your changes weren't saved. Try again; if it keeps failing, copy your text somewhere safe first.",
      );
      return;
    }
    onSaved(
      { key: res.data.key, title: localTitle(view.columns, values), values },
      res.data.count,
    );
  }

  return (
    <Drawer open onClose={onClose} label={title} side="right">
      <div className="flex min-h-full flex-col font-hub text-hub-ink">
        <div className="flex items-center justify-between gap-2 border-b border-hub-border px-6 py-4">
          <h2 className="text-xl leading-tight font-semibold">{title}</h2>
          <IconButton
            label="Close"
            tooltipAlign="end"
            onClick={onClose}
            icon={<X aria-hidden size={20} strokeWidth={2} />}
          />
        </div>
        <div className="flex flex-1 flex-col gap-6 px-6 py-6">
          {view.columns.map((c) => {
            const props = {
              id: `${uid}-${c.key}`,
              label: c.label,
              required: c.required,
              value: values[c.key] ?? "",
              ...(c.example ? { helper: `Like '${c.example}'` } : {}),
              error:
                missing === c.key
                  ? `Add the ${c.label.toLowerCase()}.`
                  : undefined,
            };
            const set = (v: string) => {
              setValues((o) => ({ ...o, [c.key]: v }));
              if (missing === c.key) setMissing(null);
            };
            return c.example.length > 40 ? (
              <TextArea
                key={c.key}
                {...props}
                rows={4}
                onChange={(e) => set(e.target.value)}
              />
            ) : (
              <TextField
                key={c.key}
                {...props}
                onChange={(e) => set(e.target.value)}
              />
            );
          })}
        </div>
        <div className="sticky bottom-0 flex flex-col gap-3 border-t border-hub-border bg-hub-surface px-6 py-4">
          {failure ? <InlineAlert tone="error">{failure}</InlineAlert> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              loading={saving}
              loadingLabel="Saving…"
              onClick={() => void save()}
            >
              {`Save ${view.singular}`}
            </Button>
            <Button variant="ghost" disabled={saving} onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </Drawer>
  );
}

export interface AddonProofSectionProps {
  view: AddonProofView;
  readOnly: boolean;
  /** After any saved change (setup marks the step saved). */
  onChanged?: () => void;
}

export function AddonProofSection({
  view,
  readOnly,
  onChanged,
}: AddonProofSectionProps) {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>(view.records);
  const [importing, setImporting] = useState(false);
  // The key of the row in the drawer, "new", or null.
  const [editing, setEditing] = useState<string | null>(null);
  const imported = useRef(0);
  useEffect(() => setRows(view.records), [view.records]);
  const headingId = `addon-proof-${view.slug}`;

  function changed() {
    onChanged?.();
    router.refresh();
  }

  function remove(key: string) {
    const index = rows.findIndex((x) => x.key === key);
    const gone = rows[index];
    if (!gone) return;
    setRows((r) => r.filter((x) => x.key !== key));
    void removeAddonIntakeRecordAction(view.slug, key)
      .catch(() => null)
      .then((res) => {
        if (!res || !res.ok) {
          setRows((r) =>
            r.some((x) => x.key === key)
              ? r
              : [...r.slice(0, index), gone, ...r.slice(index)],
          );
          toast.show({
            message:
              res && !res.ok
                ? res.message
                : "That change didn't save. Try again.",
          });
          return;
        }
        const at = res.data.index;
        changed();
        toast.show({
          message: `${cap(view.singular)} removed.`,
          action: {
            label: "Undo",
            onClick: () => {
              void saveAddonIntakeRecordAction(
                view.slug,
                gone.values,
                undefined,
                at,
              )
                .catch(() => null)
                .then((back) => {
                  if (back && back.ok) {
                    const restored = { ...gone, key: back.data.key };
                    setRows((r) => [
                      ...r.slice(0, at),
                      restored,
                      ...r.slice(at),
                    ]);
                    changed();
                  } else {
                    toast.show({
                      message: "That change didn't save. Try again.",
                    });
                  }
                });
            },
          },
        });
      });
  }

  const fields = view.fields;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h3
        id={headingId}
        className="text-xl leading-tight font-semibold text-hub-ink"
      >
        {view.name}
      </h3>
      {fields.map((f) => (
        <IntakeField
          key={f.id}
          slug={view.slug}
          field={f}
          initial={view.fieldValues[f.id] ?? (f.kind === "switch" ? false : "")}
          readOnly={readOnly}
          onSaved={() => onChanged?.()}
        />
      ))}
      {view.csvEnabled ? (
        <div className="flex flex-col gap-3">
          {rows.length > 0 ? (
            <>
              <p className="text-base text-hub-ink tabular-nums">
                {readyLine(rows.length, view.singular, view.plural)}
              </p>
              <ul
                aria-label={`Your ${view.plural}`}
                className="flex flex-col rounded border border-hub-border"
              >
                {rows.map((r, i) => {
                  const name = r.title || `${view.singular} ${i + 1}`;
                  return (
                    <li
                      key={r.key}
                      className="flex min-h-14 items-center justify-between gap-2 border-b border-hub-border px-4 last:border-b-0"
                    >
                      <span className="truncate text-base text-hub-ink">
                        {name}
                      </span>
                      {readOnly ? null : (
                        <span className="flex items-center gap-1">
                          <IconButton
                            size="sm"
                            label={`Edit ${name}`}
                            onClick={() => setEditing(r.key)}
                            icon={
                              <Pencil aria-hidden size={16} strokeWidth={2} />
                            }
                          />
                          <IconButton
                            size="sm"
                            label={`Remove ${name}`}
                            tooltipAlign="end"
                            onClick={() => remove(r.key)}
                            icon={
                              <Trash2 aria-hidden size={16} strokeWidth={2} />
                            }
                          />
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
          {readOnly ? null : (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => setImporting(true)}
                icon={<Upload aria-hidden size={16} strokeWidth={2} />}
              >
                {view.label}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setEditing("new")}
                icon={<Plus aria-hidden size={16} strokeWidth={2} />}
              >
                {view.addOneLabel}
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {!readOnly && view.csvEnabled ? (
        <CsvImportDialog
          open={importing}
          onClose={() => setImporting(false)}
          title={`Import ${view.plural}`}
          singular={view.singular}
          plural={view.plural}
          onPreview={(text, mode) =>
            previewAddonIntakeImportAction(view.slug, text, mode)
          }
          onCommit={async (text, mode) => {
            const res = await commitAddonIntakeImportAction(
              view.slug,
              text,
              mode,
            );
            if (!res.ok) return res;
            imported.current = res.data.count;
            const result: ImportCommitResult = {
              added: 0,
              updated: 0,
              removed: 0,
              backupId: "",
            };
            return { ok: true, data: result };
          }}
          onTemplate={() => {
            void templateAddonIntakeCsvAction(view.slug)
              .catch(() => null)
              .then((res) => {
                if (res && res.ok) download(res.data);
                else
                  toast.show({
                    message: "We couldn't download the template. Try again.",
                  });
              });
          }}
          onDone={() => {
            toast.show({
              message: `Imported. ${readyLine(imported.current, view.singular, view.plural)}.`,
            });
            changed();
          }}
        />
      ) : null}

      {!readOnly && editing !== null ? (
        <RecordDrawer
          view={view}
          row={
            editing === "new"
              ? null
              : (rows.find((x) => x.key === editing) ?? null)
          }
          onClose={() => setEditing(null)}
          onSaved={(row) => {
            setRows((r) =>
              editing === "new"
                ? [...r, row]
                : r.map((x) => (x.key === editing ? row : x)),
            );
            setEditing(null);
            toast.show({ message: `${cap(view.singular)} saved.` });
            changed();
          }}
        />
      ) : null}
    </section>
  );
}

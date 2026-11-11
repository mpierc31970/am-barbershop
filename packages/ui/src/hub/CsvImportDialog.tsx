"use client";
// Shared CSV import dialog (05-06; ADDON-12, ADDON-13, D120, D125, D126; 05-UI-SPEC "CSV
// import", "Copywriting Contract", "Interaction states", D-UI-P5-5/6; T-05-27..30).
//
// One native <dialog> (max 960px) with three in-place steps; the step shows as plain text
// in the title area ("Step 2 of 3 · Check"):
//   1 Choose a file   FileDrop (refuses files over MAX_IMPORT_BYTES before reading) +
//                     template link; "Checking N rows…" while the server previews.
//   2 Check           counts line (aria-pressed filters), row errors (all-or-nothing:
//                     Import is disabled while any row has an error), ignored columns,
//                     the preview table (windowed above 200 rows), the two modes.
//   2b Replace all    replaces the body (never a nested modal): lists exactly what will be
//                     removed, "Go back" is focused first (D126).
//   3 Importing       dialog locked; success closes and calls onDone, failure returns to
//                     step 2 with "The import didn't finish, so nothing changed."
// The dialog only ever sends the raw file text and the mode (plus, for Replace all, the
// removal ids the owner confirmed): the server re-plans on commit (05-08), so a tampered
// client cannot import rows that were never validated, and refuses a Replace all whose
// removals changed since the preview (D126).
// Cells render as React text, never HTML.
//
// Opt-in extensions (07-16; D120, D-UI-P7-22), additive and backward-compatible: callers that
// pass none of these props behave exactly as before (replace mode included, 07-21 uses it).
//   columnMatch  a "Match columns" step after the file is read: readHeader(text) asks the
//                server for the header, examples and suggested matches; when needsMatch the
//                ColumnMatchStep shows (every target at most once, swap-to-skip, the required
//                target blocks Next), else the dialog goes straight to Check with the
//                suggestion. The step text reads "of 4". Check offers "Change column matches".
//   additive     no "How to import" radios (adds and updates only, never removes): a fixed
//                note instead, "N merged by email" in the counts when the preview carries
//                `merged`, an optional "Tag everyone in this file" field that re-runs the
//                preview, and the primary reads "Import N <nouns>".
//   chooseHint   one more line under the template link in step 1.
// The mapping and the tag go to onPreview / onCommit as `extras`; the server re-plans with them
// on commit, so the dialog still never sends rows.
// replaceOnly: one-shot replace for non-list data such as a table block, 07-21 (no mode
// radios, no filters, no template link; the caller's summary line and confirm wording; the
// confirm calls onCommit(text, "replace", [])).
import type { ImportMode, ImportPreview } from "@cds/core/csv";
import { MAX_IMPORT_BYTES } from "@cds/core/csv";
import { Loader2, X } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { HubActionResult, ImportCommitResult } from "./addon-types";
import { Button } from "./Button";
import { InlineAlert } from "./feedback";
import { ColumnMatchStep, type ColumnMatchTarget } from "./ColumnMatchStep";
import { FileDrop } from "./FileDrop";
import { TextField } from "./fields";
import { IconButton } from "./IconButton";
import { RadioCardGroup } from "./RadioCardGroup";
import { useModalDialog } from "./useModalDialog";

/** What an opt-in import sends with the file text (column matches, one tag for everyone). */
export type ImportExtras = { mapping?: string[]; tagAll?: string };

export interface ColumnMatchConfig {
  readHeader: (text: string) => Promise<
    HubActionResult<{
      header: string[];
      examples: string[];
      suggested: string[];
      needsMatch: boolean;
    }>
  >;
  targets: readonly ColumnMatchTarget[];
  skipValue: string;
  requiredValue: string;
  requiredCopy: string;
}

export interface AdditiveConfig {
  note: string;
  tagAll?: { label: string; placeholder: string; maxLength: number };
}

type PreviewWithMerged = ImportPreview & { merged?: number };

/** Opt-in one-shot replace for non-list data, e.g. a table block (07-21). */
export interface ReplaceOnlyConfig {
  /** The check step's summary line ("184 rows, 5 columns"). */
  summary: (preview: ImportPreview) => string;
  /** The check step's primary button ("Replace table…"); always opens the confirm. */
  primaryLabel: string;
  confirmTitle: string;
  confirmBody: (preview: ImportPreview) => string;
  confirmLabel: string;
  /** Optional note under the summary. */
  note?: string;
}

export interface CsvImportDialogProps {
  open: boolean;
  onClose: () => void;
  /** "Import testimonials" */
  title: string;
  singular: string;
  plural: string;
  onPreview: (
    text: string,
    mode: ImportMode,
    extras?: ImportExtras,
  ) => Promise<HubActionResult<PreviewWithMerged>>;
  /**
   * Replace all also sends the preview's removal ids: the server deletes only that
   * confirmed set and refuses if its re-plan differs (D126).
   */
  onCommit: (
    text: string,
    mode: ImportMode,
    confirmedRemovals?: string[],
    extras?: ImportExtras,
  ) => Promise<HubActionResult<ImportCommitResult>>;
  /** Downloads the template (the panel owns the download). */
  onTemplate: () => void;
  /** Called after a successful import, once the dialog has closed. */
  onDone: (result: ImportCommitResult) => void;
  /** Opt-in "Match columns" step (07-16). */
  columnMatch?: ColumnMatchConfig;
  /** Opt-in additive-only mode (07-16, D-UI-P7-22). */
  additive?: AdditiveConfig;
  /** Extra hint under the template link in step 1. */
  chooseHint?: string;
  /** Opt-in one-shot replace (07-21). */
  replaceOnly?: ReplaceOnlyConfig;
}

type Step = "choose" | "checking" | "match" | "check" | "confirm" | "importing";
type HeaderInfo = {
  header: string[];
  examples: string[];
  suggested: string[];
  needsMatch: boolean;
};
type Filter = "all" | ImportPreview["rows"][number]["status"];
type Row = ImportPreview["rows"][number];

export const IMPORT_FAILED_COPY =
  "The import didn't finish, so nothing changed. Try again in a minute.";
export const NOTHING_TO_DO_COPY =
  "Everything in this file already matches your list.";
const ERRORS_TAIL =
  "Nothing is imported until every row is fixed. Fix them in your file and upload it again.";

const STEP_TEXT_THREE: Record<Step, string> = {
  choose: "Step 1 of 3 · Choose a file",
  checking: "Step 1 of 3 · Choose a file",
  match: "Step 1 of 3 · Choose a file",
  check: "Step 2 of 3 · Check",
  confirm: "Step 2 of 3 · Check",
  importing: "Step 3 of 3 · Importing",
};

const STEP_TEXT_FOUR: Record<Step, string> = {
  choose: "Step 1 of 4 · Choose a file",
  checking: "Step 1 of 4 · Choose a file",
  match: "Step 2 of 4 · Match columns",
  check: "Step 3 of 4 · Check",
  confirm: "Step 3 of 4 · Check",
  importing: "Step 4 of 4 · Importing",
};

/** Rows above this count are windowed (no dependency, 05-UI-SPEC Registry Safety). */
export const WINDOW_THRESHOLD = 200;
const ROW_H = 40;
const OVERSCAN = 10;
const CELL_MAX = 40;
const MAX_REMOVALS_LISTED = 20;

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

function truncate(text: string): string {
  return text.length > CELL_MAX ? `${text.slice(0, CELL_MAX - 1)}…` : text;
}

/** Rough data-row count for "Checking N rows…" (header excluded). */
export function estimateRows(text: string): number {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim() !== "");
  return Math.max(0, lines.length - 1);
}

export function errorsCopy(errors: number): string {
  return `${errors === 1 ? "1 row needs" : `${errors} rows need`} fixing. ${ERRORS_TAIL}`;
}

export function ignoredCopy(ignored: readonly string[]): string {
  return `We ignored ${plural(ignored.length, "column", "columns")} we don't use: ${ignored.join(", ")}.`;
}

const STATUS: Record<Row["status"], { word: string; cls: string }> = {
  new: { word: "New", cls: "bg-hub-success-tint text-hub-success" },
  updated: { word: "Updated", cls: "bg-hub-warning-tint text-hub-ink" },
  unchanged: { word: "Unchanged", cls: "bg-hub-surface-2 text-hub-ink-muted" },
  duplicate: {
    word: "Duplicate, skipped",
    cls: "bg-hub-surface-2 text-hub-ink-muted",
  },
  error: { word: "Error", cls: "bg-hub-danger-tint text-hub-danger" },
};

/** Error rows first; otherwise file order (stable). */
function sortRows(rows: readonly Row[]): Row[] {
  return [...rows].sort(
    (a, b) =>
      Number(b.status === "error") - Number(a.status === "error") ||
      a.rowNumber - b.rowNumber,
  );
}

function PreviewTable({
  preview,
  filter,
  dimmed,
  hideStatus = false,
}: {
  preview: ImportPreview;
  filter: Filter;
  dimmed: boolean;
  hideStatus?: boolean;
}) {
  const baseId = useId();
  const rows = useMemo(
    () =>
      sortRows(
        filter === "all"
          ? preview.rows
          : preview.rows.filter((r) => r.status === filter),
      ),
    [preview.rows, filter],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const windowed = rows.length > WINDOW_THRESHOLD;

  // Each record is one unit: its row, plus a message sub-row when it has messages.
  const heights = useMemo(
    () => rows.map((r) => (r.messages.length > 0 ? 2 * ROW_H : ROW_H)),
    [rows],
  );
  let first = 0;
  let last = rows.length;
  let before = 0;
  let after = 0;
  if (windowed) {
    const viewH = scrollRef.current?.clientHeight || 480;
    let y = 0;
    first = rows.length;
    for (let i = 0; i < rows.length; i++) {
      const h = heights[i]!;
      if (y + h >= scrollTop && first === rows.length) first = i;
      if (y > scrollTop + viewH) {
        last = i;
        break;
      }
      y += h;
    }
    first = Math.max(0, first - OVERSCAN);
    last = Math.min(rows.length, last + OVERSCAN);
    for (let i = 0; i < first; i++) before += heights[i]!;
    for (let i = last; i < rows.length; i++) after += heights[i]!;
  }
  const colSpan = preview.columns.length + (hideStatus ? 1 : 2);

  return (
    <div
      ref={scrollRef}
      data-preview-scroll=""
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      className={
        "min-h-0 flex-1 overflow-auto rounded border border-hub-border " +
        "transition-opacity duration-150 " +
        (dimmed ? "opacity-60" : "")
      }
    >
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">Rows in your file</caption>
        <thead className="sticky top-0 z-10 bg-hub-surface-2">
          <tr>
            <th
              scope="col"
              className="px-3 py-2 font-semibold whitespace-nowrap"
            >
              Row #
            </th>
            {hideStatus ? null : (
              <th scope="col" className="px-3 py-2 font-semibold">
                Status
              </th>
            )}
            {preview.columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className="px-3 py-2 font-semibold whitespace-nowrap"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {before > 0 ? (
            <tr aria-hidden="true" style={{ height: before }}>
              <td colSpan={colSpan} />
            </tr>
          ) : null}
          {rows.slice(first, last).map((r) => {
            const msgId = `${baseId}-m${r.rowNumber}`;
            const hasMsg = r.messages.length > 0;
            const status = STATUS[r.status];
            return (
              <RowPair key={r.rowNumber}>
                <tr
                  data-row={r.rowNumber}
                  data-status={r.status}
                  aria-describedby={hasMsg ? msgId : undefined}
                  className={
                    "h-10 tabular-nums " +
                    (hasMsg ? "" : "border-b border-hub-border")
                  }
                >
                  <td className="px-3 py-2 text-hub-ink-muted">
                    {r.rowNumber}
                  </td>
                  {hideStatus ? null : (
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded px-2 py-1 font-semibold whitespace-nowrap ${status.cls}`}
                      >
                        {status.word}
                      </span>
                    </td>
                  )}
                  {preview.columns.map((c) => {
                    const full = r.cells[c.key] ?? "";
                    const changed = r.changed.includes(c.key);
                    return (
                      <td
                        key={c.key}
                        title={full.length > CELL_MAX ? full : undefined}
                        className={
                          "px-3 py-2 whitespace-nowrap " +
                          (changed ? "font-semibold" : "")
                        }
                      >
                        {truncate(full)}
                      </td>
                    );
                  })}
                </tr>
                {hasMsg ? (
                  <tr className="border-b border-hub-border">
                    <td
                      id={msgId}
                      colSpan={colSpan}
                      className={
                        "px-3 pb-2 " +
                        (r.status === "error"
                          ? "text-hub-danger"
                          : "text-hub-ink-muted")
                      }
                    >
                      {r.messages.join(" ")}
                    </td>
                  </tr>
                ) : null}
              </RowPair>
            );
          })}
          {after > 0 ? (
            <tr aria-hidden="true" style={{ height: after }}>
              <td colSpan={colSpan} />
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function RowPair({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function CsvImportDialog({
  open,
  onClose,
  title,
  singular,
  plural: pluralNoun,
  onPreview,
  onCommit,
  onTemplate,
  onDone,
  columnMatch,
  additive,
  chooseHint,
  replaceOnly,
}: CsvImportDialogProps) {
  const [step, setStep] = useState<Step>("choose");
  const [text, setText] = useState<string | null>(null);
  const [checkingRows, setCheckingRows] = useState(0);
  const initialMode: ImportMode = replaceOnly ? "replace" : "update";
  const [mode, setMode] = useState<ImportMode>(initialMode);
  const [preview, setPreview] = useState<PreviewWithMerged | null>(null);
  const [replaceCount, setReplaceCount] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [fileError, setFileError] = useState<string | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  // Opt-in (07-16): the file's header for the match step, the extras of the shown preview,
  // and the "Tag everyone" field as typed.
  const [headerInfo, setHeaderInfo] = useState<HeaderInfo | null>(null);
  const [extras, setExtras] = useState<ImportExtras>({});
  const [tagDraft, setTagDraft] = useState("");
  const titleId = useId();
  const tagFieldId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Ignore a preview answer that arrives after the owner moved on (new file, new mode). The
  // header read and the tag re-preview count too (07-16).
  const seq = useRef(0);

  const locked = step === "importing";
  const optIn = columnMatch !== undefined || additive !== undefined;
  const STEP_TEXT = columnMatch ? STEP_TEXT_FOUR : STEP_TEXT_THREE;

  function reset() {
    seq.current += 1;
    setStep("choose");
    setText(null);
    setMode(initialMode);
    setPreview(null);
    setReplaceCount(null);
    setFilter("all");
    setFileError(null);
    setStepError(null);
    setPreviewing(false);
    setHeaderInfo(null);
    setExtras({});
    setTagDraft("");
  }

  function close() {
    if (locked) return;
    reset();
    onClose();
  }

  const ref = useModalDialog(open, close);

  // Step change moves focus to the step heading; the Replace-all confirm focuses the safe
  // choice instead ("Go back" has autoFocus).
  useEffect(() => {
    if (!open) return;
    if (step === "confirm") {
      ref.current
        ?.querySelector<HTMLButtonElement>("button[data-safe-choice]")
        ?.focus();
    } else if (step === "check" || step === "choose" || step === "match") {
      headingRef.current?.focus();
    }
  }, [step, open, ref]);

  /**
   * `from` is where a failure lands: "choose" (the first preview of a file: the error shows
   * on step 1), "match" (Next on the match step) or "check" (a mode or tag change: the table
   * keeps the last good preview).
   */
  async function runPreview(
    fileText: string,
    nextMode: ImportMode,
    from: "choose" | "match" | "check",
    nextExtras?: ImportExtras,
  ) {
    const n = ++seq.current;
    setPreviewing(true);
    let res: HubActionResult<PreviewWithMerged>;
    try {
      res =
        optIn && nextExtras
          ? await onPreview(fileText, nextMode, nextExtras)
          : await onPreview(fileText, nextMode);
    } catch {
      res = { ok: false, code: "save_failed", message: IMPORT_FAILED_COPY };
    }
    if (n !== seq.current) return;
    setPreviewing(false);
    if (!res.ok) {
      if (from === "choose") {
        setFileError(res.message);
        setStep("choose");
      } else if (from === "match") {
        setStepError(res.message);
      } else {
        // The table still shows the last good preview, so the mode and the tag go back to
        // match it.
        if (!additive) setMode(nextMode === "replace" ? "update" : "replace");
        setTagDraft(extras.tagAll ?? "");
        setStepError(res.message);
      }
      return;
    }
    setStepError(null);
    setPreview(res.data);
    setMode(res.data.mode);
    if (nextExtras) setExtras(nextExtras);
    if (res.data.mode === "replace") setReplaceCount(res.data.removals.length);
    setStep("check");
  }

  async function readHeader(fileText: string, config: ColumnMatchConfig) {
    const n = ++seq.current;
    let res: Awaited<ReturnType<ColumnMatchConfig["readHeader"]>>;
    try {
      res = await config.readHeader(fileText);
    } catch {
      res = { ok: false, code: "save_failed", message: IMPORT_FAILED_COPY };
    }
    if (n !== seq.current) return;
    if (!res.ok) {
      setFileError(res.message);
      setStep("choose");
      return;
    }
    setHeaderInfo(res.data);
    if (res.data.needsMatch) {
      setStep("match");
      return;
    }
    void runPreview(fileText, "update", "choose", {
      mapping: [...res.data.suggested],
      ...(extras.tagAll ? { tagAll: extras.tagAll } : {}),
    });
  }

  function onFile(fileText: string) {
    setFileError(null);
    setStepError(null);
    setPreview(null);
    setReplaceCount(null);
    setFilter("all");
    setHeaderInfo(null);
    setText(fileText);
    setCheckingRows(estimateRows(fileText));
    setStep("checking");
    if (columnMatch) void readHeader(fileText, columnMatch);
    else if (additive) void runPreview(fileText, "update", "choose", {});
    else void runPreview(fileText, mode, "choose");
  }

  function chooseAnother() {
    seq.current += 1;
    setStep("choose");
    setText(null);
    setPreview(null);
    setReplaceCount(null);
    setFilter("all");
    setStepError(null);
    setPreviewing(false);
    setHeaderInfo(null);
  }

  function changeMode(next: ImportMode) {
    if (next === mode || text === null) return;
    setMode(next);
    setStepError(null);
    void runPreview(text, next, "check");
  }

  function matched(mapping: string[]) {
    if (text === null) return;
    setStepError(null);
    void runPreview(text, "update", "match", {
      mapping,
      ...(extras.tagAll ? { tagAll: extras.tagAll } : {}),
    });
  }

  /** "Tag everyone in this file": re-check when the tag changed (blur or Enter). */
  function tagCommitted() {
    if (text === null || !preview) return;
    const t = tagDraft.trim();
    if (t === (extras.tagAll ?? "")) return;
    const next: ImportExtras = { ...extras };
    if (t === "") delete next.tagAll;
    else next.tagAll = t;
    setStepError(null);
    void runPreview(text, "update", "check", next);
  }

  async function commit() {
    if (text === null || !preview) return;
    const back: Step = "check";
    setStep("importing");
    setStepError(null);
    let res: HubActionResult<ImportCommitResult>;
    try {
      res = replaceOnly
        ? await onCommit(text, "replace", [])
        : preview.mode === "replace"
          ? await onCommit(
              text,
              preview.mode,
              preview.removals.map((r) => r.id),
            )
          : optIn
            ? await onCommit(text, preview.mode, undefined, extras)
            : await onCommit(text, preview.mode);
    } catch {
      res = { ok: false, code: "save_failed", message: IMPORT_FAILED_COPY };
    }
    if (!res.ok) {
      setStep(back);
      // invalid_input is the server re-plan's own UI copy, e.g. "Your list changed since you
      // checked the file" when Replace all's removals moved (A-WR-03 / C-WR-04). Retrying
      // can't fix those, so "try again in a minute" would mislead.
      setStepError(
        res.code === "signed_out" ||
          res.code === "forbidden" ||
          res.code === "invalid_input"
          ? res.message
          : IMPORT_FAILED_COPY,
      );
      return;
    }
    reset();
    onClose();
    onDone(res.data);
  }

  const errors = preview?.counts.errors ?? 0;
  const changes = preview?.changes ?? 0;
  const replacing = preview?.mode === "replace";
  const removals = preview?.removals ?? [];
  const blocked = errors > 0 || changes === 0 || previewing;

  function primaryClick() {
    if (blocked) return;
    if (replaceOnly) setStep("confirm");
    else if (replacing && removals.length > 0) setStep("confirm");
    else void commit();
  }

  const heading =
    step === "confirm" && replaceOnly
      ? replaceOnly.confirmTitle
      : step === "confirm"
        ? `Remove ${plural(removals.length, singular, pluralNoun)}?`
        : title;

  const counts = preview?.counts;
  const filters: { key: Filter; text: string }[] = counts
    ? [
        { key: "new", text: `${counts.new} new` },
        { key: "updated", text: `${counts.updated} updated` },
        { key: "unchanged", text: `${counts.unchanged} unchanged` },
        {
          key: "duplicate",
          text: `${plural(counts.duplicates, "duplicate", "duplicates")} removed`,
        },
        {
          key: "error",
          text: plural(counts.errors, "error", "errors"),
        },
      ]
    : [];

  const replaceDescription =
    replaceCount === null
      ? `Your list becomes exactly this file. Any ${pluralNoun} not in the file will be removed.`
      : `Your list becomes exactly this file. ${plural(replaceCount, singular, pluralNoun)} not in the file will be removed.`;

  let body: ReactNode;
  let footer: ReactNode = null;

  if (step === "choose" || step === "checking") {
    body = (
      <div className="flex flex-col gap-4">
        {fileError ? <InlineAlert tone="error">{fileError}</InlineAlert> : null}
        {step === "checking" ? (
          <p
            role="status"
            className="flex min-h-40 items-center justify-center gap-2 text-base text-hub-ink-muted"
          >
            <Loader2
              aria-hidden
              size={16}
              strokeWidth={2}
              className="animate-spin motion-reduce:animate-none"
            />
            {`Checking ${plural(checkingRows, "row", "rows")}…`}
          </p>
        ) : (
          <FileDrop
            maxBytes={MAX_IMPORT_BYTES}
            onText={(t) => onFile(t)}
            onError={(m) => setFileError(m)}
          />
        )}
        <div className="flex flex-col gap-1 text-sm text-hub-ink-muted">
          {replaceOnly ? null : (
            <p>
              Start from our template:{" "}
              <button
                type="button"
                onClick={onTemplate}
                className="rounded text-hub-accent underline underline-offset-2"
              >
                Download the template
              </button>
            </p>
          )}
          {chooseHint ? <p>{chooseHint}</p> : null}
          {additive || replaceOnly ? null : (
            <p>
              Editing a list you exported? Keep the id column so rows match.
            </p>
          )}
        </div>
      </div>
    );
  } else if (step === "match" && columnMatch && headerInfo) {
    body = (
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        {stepError ? <InlineAlert tone="error">{stepError}</InlineAlert> : null}
        <ColumnMatchStep
          header={headerInfo.header}
          examples={headerInfo.examples}
          suggested={extras.mapping ?? headerInfo.suggested}
          targets={columnMatch.targets}
          skipValue={columnMatch.skipValue}
          requiredValue={columnMatch.requiredValue}
          requiredCopy={columnMatch.requiredCopy}
          busy={previewing}
          onBack={chooseAnother}
          onNext={matched}
        />
      </div>
    );
  } else if (step === "confirm" && replaceOnly && preview) {
    body = (
      <div className="flex flex-col gap-4 text-base">
        <p data-replace-only-body="">{replaceOnly.confirmBody(preview)}</p>
      </div>
    );
    footer = (
      <>
        <Button
          variant="ghost"
          data-safe-choice=""
          autoFocus
          onClick={() => setStep("check")}
        >
          Go back
        </Button>
        <Button variant="destructive" onClick={() => void commit()}>
          {replaceOnly.confirmLabel}
        </Button>
      </>
    );
  } else if (step === "confirm") {
    const listed = removals.slice(0, MAX_REMOVALS_LISTED);
    const more = removals.length - listed.length;
    body = (
      <div className="flex flex-col gap-4 text-base">
        <p>
          Replacing your list removes these, because they aren&apos;t in the
          file:
        </p>
        <ul
          data-removals=""
          className="flex max-h-80 list-disc flex-col gap-1 overflow-auto pl-6"
        >
          {listed.map((r) => (
            <li key={r.id}>{r.title}</li>
          ))}
        </ul>
        {more > 0 ? <p>{`and ${more} more`}</p> : null}
        <p>
          A backup of your current list is saved first, so you can undo this
          from Backups.
        </p>
      </div>
    );
    footer = (
      <>
        <Button
          variant="ghost"
          data-safe-choice=""
          autoFocus
          onClick={() => setStep("check")}
        >
          Go back
        </Button>
        <Button variant="destructive" onClick={() => void commit()}>
          {`Replace all and remove ${removals.length}`}
        </Button>
      </>
    );
  } else if (preview) {
    const importing = step === "importing";
    body = (
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        {stepError ? <InlineAlert tone="error">{stepError}</InlineAlert> : null}
        {replaceOnly ? (
          <div className="flex flex-col gap-1">
            <p
              data-replace-only-summary=""
              className="text-base font-semibold tabular-nums"
            >
              {replaceOnly.summary(preview)}
            </p>
            {replaceOnly.note ? (
              <p className="text-sm text-hub-ink-muted">{replaceOnly.note}</p>
            ) : null}
          </div>
        ) : (
          <div
            role="group"
            aria-label="Show rows"
            className="flex flex-wrap items-center gap-x-1 gap-y-2 text-base font-semibold tabular-nums"
          >
            {filters.map((f, i) => (
              <span key={f.key} className="inline-flex items-center gap-1">
                {i > 0 ? (
                  <span aria-hidden className="text-hub-ink-muted">
                    ·
                  </span>
                ) : null}
                <button
                  type="button"
                  aria-pressed={filter === f.key}
                  onClick={() => setFilter(filter === f.key ? "all" : f.key)}
                  className={
                    "rounded px-2 py-1 transition-colors duration-150 hover:bg-hub-surface-2 " +
                    (filter === f.key ? "bg-hub-surface-2 underline" : "")
                  }
                >
                  {f.text}
                </button>
              </span>
            ))}
            <button
              type="button"
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
              className="ml-2 rounded px-2 py-1 text-sm font-normal text-hub-accent underline underline-offset-2"
            >
              All
            </button>
            {additive && (preview.merged ?? 0) > 0 ? (
              <span
                data-merged=""
                className="ml-2 text-sm font-normal text-hub-ink-muted"
              >
                {`${preview.merged} merged by email`}
              </span>
            ) : null}
          </div>
        )}
        {errors > 0 ? (
          <InlineAlert
            tone="error"
            action={
              <Button size="sm" onClick={chooseAnother}>
                Choose another file
              </Button>
            }
          >
            {errorsCopy(errors)}
          </InlineAlert>
        ) : null}
        {preview.ignored.length > 0 ? (
          <InlineAlert tone="info">{ignoredCopy(preview.ignored)}</InlineAlert>
        ) : null}
        <PreviewTable
          preview={preview}
          filter={filter}
          dimmed={importing || (optIn && previewing)}
          hideStatus={replaceOnly !== undefined}
        />
        {additive?.tagAll ? (
          <div className="md:max-w-sm">
            <TextField
              id={tagFieldId}
              label={additive.tagAll.label}
              placeholder={additive.tagAll.placeholder}
              maxLength={additive.tagAll.maxLength}
              value={tagDraft}
              disabled={importing}
              labelExtra={
                <span className="text-sm text-hub-ink-muted">Optional</span>
              }
              onChange={(e) => setTagDraft(e.target.value)}
              onBlur={tagCommitted}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  tagCommitted();
                }
              }}
            />
          </div>
        ) : null}
        {replaceOnly ? null : additive ? (
          <p data-additive-note="" className="text-sm text-hub-ink-muted">
            {additive.note}
          </p>
        ) : (
          <RadioCardGroup<ImportMode>
            name={`${titleId}-mode`}
            legend="How to import"
            value={mode}
            onChange={changeMode}
            options={[
              {
                value: "update",
                title: "Update only what changed",
                description:
                  "Adds new rows and updates changed ones. Nothing is removed.",
                disabled: importing,
              },
              {
                value: "replace",
                title: "Replace all",
                description: replaceDescription,
                disabled: importing,
              },
            ]}
          />
        )}
        {changes === 0 && errors === 0 ? (
          <p className="text-sm text-hub-ink-muted">{NOTHING_TO_DO_COPY}</p>
        ) : null}
      </div>
    );
    const label = replaceOnly
      ? replaceOnly.primaryLabel
      : replacing
        ? "Replace all…"
        : additive
          ? `Import ${plural(changes, singular, pluralNoun)}`
          : `Import ${plural(changes, "change", "changes")}`;
    footer = (
      <>
        {columnMatch && headerInfo ? (
          <Button
            variant="ghost"
            disabled={importing}
            onClick={() => {
              seq.current += 1;
              setPreviewing(false);
              setStepError(null);
              setStep("match");
            }}
          >
            Change column matches
          </Button>
        ) : null}
        <Button onClick={chooseAnother} disabled={importing}>
          Choose another file
        </Button>
        <Button
          variant="primary"
          disabled={blocked}
          loading={importing}
          loadingLabel="Importing…"
          title={
            errors > 0
              ? `Fix the ${plural(errors, "row", "rows")} with errors first`
              : undefined
          }
          onClick={primaryClick}
        >
          {label}
        </Button>
      </>
    );
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-busy={locked || undefined}
      className={
        "m-auto max-h-[calc(100vh-64px)] w-[calc(100%-32px)] max-w-[960px] rounded " +
        "bg-hub-surface p-0 font-hub text-hub-ink shadow-xl backdrop:bg-hub-ink/40"
      }
    >
      <div className="flex max-h-[calc(100vh-64px)] flex-col gap-4 p-6 md:p-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2
              id={titleId}
              ref={headingRef}
              tabIndex={-1}
              className="text-xl leading-tight font-semibold focus:outline-none"
            >
              {heading}
            </h2>
            {step === "confirm" ? null : (
              <p className="text-sm text-hub-ink-muted">{STEP_TEXT[step]}</p>
            )}
          </div>
          <IconButton
            label="Close"
            tooltipAlign="end"
            aria-disabled={locked || undefined}
            onClick={close}
            icon={<X aria-hidden size={20} strokeWidth={2} />}
          />
        </div>
        <div
          key={step === "confirm" ? "confirm" : "main"}
          className="flex min-h-0 flex-1 flex-col transition-opacity duration-150 starting:opacity-0 motion-reduce:transition-none"
        >
          {body}
        </div>
        {footer ? (
          <div
            key={step === "confirm" ? "confirm" : "main"}
            className="flex flex-wrap justify-end gap-2"
          >
            {footer}
          </div>
        ) : null}
      </div>
    </dialog>
  );
}

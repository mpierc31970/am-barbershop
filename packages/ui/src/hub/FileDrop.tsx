"use client";
// CSV file drop zone (05-06; 05-UI-SPEC "CSV import" step 1, "Accessibility contract";
// T-05-27). A real <input type="file" accept=".csv,text/csv"> inside its <label> is the
// keyboard path; drag and drop is an enhancement. 1px dashed hub-border-strong box on
// hub-surface-2, min-height 160px; while a file is dragged over it, 2px dashed accent on
// accent tint. A file over maxBytes is refused before it is read (MAX_IMPORT_BYTES from
// @cds/core/csv is what CsvImportDialog passes), so a huge file never reaches memory or
// the server. The contents are read as text only.
// P14 (14-30 choice 2): optional `accept`, `hint`, `tooBigCopy` and `unreadableCopy` let the
// zone-file upload reuse it; the defaults keep the CSV copy, so existing uses are unchanged.
import { Upload } from "lucide-react";
import { useId, useState, type DragEvent } from "react";

export const FILE_TOO_BIG_COPY =
  "This file is too big. Import up to 2,000 rows at a time.";

export const FILE_NOT_CSV_COPY =
  'This file isn\'t a CSV. Save it from Excel or Google Sheets as "CSV", then upload it.';

export interface FileDropProps {
  onText: (text: string, file: File) => void;
  onError: (message: string) => void;
  /** Largest file accepted, in bytes. */
  maxBytes: number;
  disabled?: boolean;
  /** The file input's accept list. Default `.csv,text/csv`. */
  accept?: string;
  /** Words before the "choose a file" link. Default "Drop a CSV file here, or". */
  hint?: string;
  /** Error copy for a file over maxBytes. Default FILE_TOO_BIG_COPY. */
  tooBigCopy?: string;
  /** Error copy when the file can't be read as text. Default FILE_NOT_CSV_COPY. */
  unreadableCopy?: string;
}

async function readText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsText(file);
  });
}

export function FileDrop({
  onText,
  onError,
  maxBytes,
  disabled = false,
  accept = ".csv,text/csv",
  hint = "Drop a CSV file here, or",
  tooBigCopy = FILE_TOO_BIG_COPY,
  unreadableCopy = FILE_NOT_CSV_COPY,
}: FileDropProps) {
  const inputId = useId();
  const [over, setOver] = useState(false);

  async function take(file: File | undefined) {
    if (!file || disabled) return;
    if (file.size > maxBytes) {
      onError(tooBigCopy);
      return;
    }
    try {
      onText(await readText(file), file);
    } catch {
      onError(unreadableCopy);
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
    void take(e.dataTransfer?.files?.[0]);
  }

  return (
    <div
      data-file-drop=""
      data-over={over || undefined}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={
        "flex min-h-40 flex-col items-center justify-center gap-2 rounded p-6 text-center " +
        "font-hub text-base text-hub-ink transition-colors duration-150 " +
        (over
          ? "border-2 border-dashed border-hub-accent bg-hub-accent-tint"
          : "border border-dashed border-hub-border-strong bg-hub-surface-2") +
        (disabled ? " opacity-50" : "")
      }
    >
      <Upload aria-hidden size={20} strokeWidth={2} />
      <p>
        {hint}{" "}
        <label
          htmlFor={inputId}
          className={
            "cursor-pointer rounded text-hub-accent underline underline-offset-2 " +
            "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 " +
            "has-focus-visible:outline-hub-accent"
          }
        >
          choose a file
          <input
            id={inputId}
            type="file"
            accept={accept}
            disabled={disabled}
            className="sr-only"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              // Clear it so choosing the same file again (after fixing it) fires again.
              e.currentTarget.value = "";
              void take(file);
            }}
          />
        </label>
      </p>
    </div>
  );
}

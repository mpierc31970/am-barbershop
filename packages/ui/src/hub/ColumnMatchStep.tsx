"use client";
// Column matching step for the shared CsvImportDialog (07-16; D120, D119, D-UI-P7-22;
// 07-UI-SPEC "Contacts CSV import" step 2). Opt-in and generic: any import whose spreadsheets
// come from other tools (a Mailchimp, Square or Google Contacts export) can show it.
// One row per column of the file: "Column in your file" (Label 600) · "Example" (first
// non-empty value, ink-muted, cut to 40 characters) · "Goes to" (Select of the targets),
// preset from the server's suggestion. Every target is used at most once: choosing one that
// another column already has moves that column to the skip target ("Don't import"). With no
// column on the required target the error shows, "Next: check rows" is disabled and points
// at it. Cells are React text.
import { useId, useState } from "react";
import { Button } from "./Button";
import { InlineAlert } from "./feedback";

export interface ColumnMatchTarget {
  value: string;
  label: string;
}

export interface ColumnMatchStepProps {
  header: readonly string[];
  examples: readonly string[];
  suggested: readonly string[];
  targets: readonly ColumnMatchTarget[];
  skipValue: string;
  requiredValue: string;
  requiredCopy: string;
  onNext: (mapping: string[]) => void;
  onBack: () => void;
  /** The preview is running after Next. */
  busy?: boolean;
}

const EXAMPLE_MAX = 40;

function cut(text: string): string {
  return text.length > EXAMPLE_MAX
    ? `${text.slice(0, EXAMPLE_MAX - 1)}…`
    : text;
}

/** The suggestion, made valid: unknown targets and repeats become the skip target. */
export function normalizeMapping(
  header: readonly string[],
  suggested: readonly string[],
  targets: readonly ColumnMatchTarget[],
  skipValue: string,
): string[] {
  const known = new Set(targets.map((t) => t.value));
  const used = new Set<string>();
  return header.map((_, i) => {
    const v = suggested[i];
    if (v === undefined || !known.has(v) || v === skipValue || used.has(v)) {
      return skipValue;
    }
    used.add(v);
    return v;
  });
}

/** Column `index` goes to `value`; any other column on that target moves to skip. */
export function assignColumn(
  mapping: readonly string[],
  index: number,
  value: string,
  skipValue: string,
): string[] {
  return mapping.map((v, i) => {
    if (i === index) return value;
    if (value !== skipValue && v === value) return skipValue;
    return v;
  });
}

export function ColumnMatchStep({
  header,
  examples,
  suggested,
  targets,
  skipValue,
  requiredValue,
  requiredCopy,
  onNext,
  onBack,
  busy = false,
}: ColumnMatchStepProps) {
  const [mapping, setMapping] = useState<string[]>(() =>
    normalizeMapping(header, suggested, targets, skipValue),
  );
  const uid = useId();
  const alertId = `${uid}-required`;
  const missing = !mapping.includes(requiredValue);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 font-hub">
      <div className="min-h-0 flex-1 overflow-auto rounded border border-hub-border">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">Match the columns in your file</caption>
          <thead className="sticky top-0 z-10 bg-hub-surface-2">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">
                Column in your file
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                Example
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                Goes to
              </th>
            </tr>
          </thead>
          <tbody>
            {header.map((h, i) => {
              const example = examples[i] ?? "";
              return (
                <tr
                  key={`${i}-${h}`}
                  data-match-row={i}
                  className="border-b border-hub-border"
                >
                  <th scope="row" className="px-3 py-2 font-semibold">
                    {h}
                  </th>
                  <td
                    className="px-3 py-2 text-hub-ink-muted"
                    title={example.length > EXAMPLE_MAX ? example : undefined}
                  >
                    {cut(example)}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      aria-label={`Goes to, for ${h || `column ${i + 1}`}`}
                      value={mapping[i] ?? skipValue}
                      disabled={busy}
                      onChange={(e) =>
                        setMapping((m) =>
                          assignColumn(m, i, e.target.value, skipValue),
                        )
                      }
                      className={
                        "h-10 w-full min-w-40 rounded border border-hub-border-strong bg-hub-surface " +
                        "px-3 text-base text-hub-ink transition-colors duration-150 " +
                        "hover:border-hub-ink-muted pointer-coarse:h-11"
                      }
                    >
                      {targets.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {missing ? (
        <div id={alertId}>
          <InlineAlert tone="error">{requiredCopy}</InlineAlert>
        </div>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onBack} disabled={busy}>
          Choose another file
        </Button>
        <Button
          variant="primary"
          disabled={missing}
          loading={busy}
          loadingLabel="Checking…"
          aria-describedby={missing ? alertId : undefined}
          onClick={() => {
            if (!missing) onNext(mapping);
          }}
        >
          Next: check rows
        </Button>
      </div>
    </div>
  );
}

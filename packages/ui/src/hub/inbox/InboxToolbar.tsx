"use client";
// Inbox toolbar (07-19; CONT-25, D-UI-P7-20, D311; 07-UI-SPEC "Inbox" toolbar). A GET form
// (`/hub/inbox`, hidden tab) so it works without JS: a "Form" select ("All forms" + each
// form, soft-deleted ones labelled "(deleted)") and the "Search messages" box. With JS a form
// change calls onChange(patch) at once and the search after a 300ms pause; the URL stays the
// source of truth (the app replaces it). Right side: Export CSV (secondary, Download icon),
// enabled only when one form is chosen (D-UI-P7-20: CSV per form); otherwise disabled with
// "Choose a form to export its messages." as its tooltip and description.
import { Download, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../Button";
import { SEARCH_DEBOUNCE_MS } from "../contacts/ContactFilters";
import {
  INBOX_COPY,
  INBOX_EXPORT_HINT,
  INBOX_SEARCH_PLACEHOLDER,
  formLabel,
  type InboxFormOption,
} from "./copy";

export type InboxFilterPatch = { form?: string | null; q?: string | null };

export interface InboxToolbarProps {
  tab: "messages" | "filtered";
  forms: readonly InboxFormOption[];
  form?: string;
  q?: string;
  onChange: (patch: InboxFilterPatch) => void;
  onExport: () => void;
  exporting?: boolean;
  /** Where the no-JS GET form submits. */
  action?: string;
}

const CONTROL =
  "h-10 rounded border border-hub-border-strong bg-hub-surface px-3 font-hub text-base " +
  "text-hub-ink transition-colors duration-150 hover:border-hub-ink-muted pointer-coarse:h-11";

export function InboxToolbar({
  tab,
  forms,
  form,
  q: qValue,
  onChange,
  onExport,
  exporting = false,
  action = "/hub/inbox",
}: InboxToolbarProps) {
  const uid = useId();
  const hintId = `${uid}-export-hint`;
  const [q, setQ] = useState(qValue ?? "");
  const [seenQ, setSeenQ] = useState(qValue ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The URL changed under us (Clear filters, Back): show its search text.
  if ((qValue ?? "") !== seenQ) {
    setSeenQ(qValue ?? "");
    setQ(qValue ?? "");
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function typed(v: string): void {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      onChange({ q: v.trim() || null });
    }, SEARCH_DEBOUNCE_MS);
  }

  const options = [
    { value: "", label: INBOX_COPY.allForms },
    ...forms.map((f) => ({ value: f.id, label: formLabel(f.name, f.deleted) })),
  ];
  // A form in the URL that is no longer listed still shows as chosen.
  if (form && !forms.some((f) => f.id === form)) {
    options.push({ value: form, label: INBOX_COPY.unknownForm });
  }
  const canExport = Boolean(form);

  return (
    <div className="flex flex-col gap-4 font-hub md:flex-row md:items-end md:justify-between">
      <form
        method="get"
        action={action}
        role="search"
        aria-label="Filter messages"
        onSubmit={(e) => {
          e.preventDefault();
          if (timer.current) clearTimeout(timer.current);
          timer.current = null;
          onChange({ q: q.trim() || null });
        }}
        className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-end"
      >
        <input type="hidden" name="tab" value={tab} />
        <div className="flex flex-col gap-1">
          <label
            htmlFor={`${uid}-form`}
            className="text-sm font-semibold text-hub-ink"
          >
            {INBOX_COPY.formFilter}
          </label>
          <select
            id={`${uid}-form`}
            name="form"
            value={form ?? ""}
            onChange={(e) => onChange({ form: e.target.value || null })}
            className={`${CONTROL} md:max-w-64`}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1 md:w-72">
          <label
            htmlFor={`${uid}-q`}
            className="text-sm font-semibold text-hub-ink"
          >
            {INBOX_COPY.search}
          </label>
          <div className="relative">
            <Search
              aria-hidden
              size={16}
              strokeWidth={2}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-hub-ink-muted"
            />
            <input
              id={`${uid}-q`}
              type="search"
              name="q"
              value={q}
              maxLength={100}
              placeholder={INBOX_SEARCH_PLACEHOLDER}
              onChange={(e) => typed(e.target.value)}
              className={`${CONTROL} w-full pl-9 placeholder:text-hub-ink-muted`}
            />
          </div>
        </div>
        <noscript>
          <Button type="submit">Apply filters</Button>
        </noscript>
      </form>
      <span
        className="inline-flex"
        title={canExport ? undefined : INBOX_EXPORT_HINT}
      >
        <Button
          variant="secondary"
          data-inbox-export=""
          disabled={!canExport}
          loading={exporting}
          aria-describedby={canExport ? undefined : hintId}
          icon={<Download aria-hidden size={16} strokeWidth={2} />}
          onClick={onExport}
        >
          {INBOX_COPY.exportCsv}
        </Button>
        {canExport ? null : (
          <span id={hintId} className="sr-only">
            {INBOX_EXPORT_HINT}
          </span>
        )}
      </span>
    </div>
  );
}

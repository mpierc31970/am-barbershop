"use client";
// Filter bar (13-07 choice 2; 13-UI-SPEC Inbox "Header and toolbar"). A plain
// `<form method="get">` so a filtered view is a link (no client store): labelled native
// selects (Label size, 32px, 44px on coarse pointers), an optional search field, hidden
// params that must survive (tab, open), a "Clear filters" link while any filter is set, and
// the polite result line ("12 tickets · 2 at risk · 1 missed"). A select change submits the
// form; empty fields are left out of the URL. Values outside an option list fall back to Any
// (T-13-07-02), and every href is built with URLSearchParams.
import type { FormEvent, ReactNode } from "react";
import { STAFF_TABLE_COPY as C } from "./copy";

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterField {
  /** URL param name (`type`, `status`, `priority`, `assignee`, `org`, `sla`). */
  name: string;
  label: string;
  options: readonly FilterOption[];
  /** The current URL value; anything not in `options` reads as Any. */
  value?: string | null;
}

export interface FilterSearch {
  name: string;
  label: string;
  value?: string | null;
  /** Screen-reader helper, e.g. "Ticket number or subject". */
  helper?: string;
}

export interface FilterBarProps {
  /** The page path the form GETs (e.g. "/staff/tickets"). */
  action: string;
  filters: readonly FilterField[];
  search?: FilterSearch;
  /** Params kept as hidden fields and in the Clear filters link (e.g. { tab: "inbox" }). */
  hidden?: Readonly<Record<string, string>>;
  /** Polite live result line under the bar. */
  resultLine?: string;
  /** Leading slot, normally <QuickFilters>. */
  children?: ReactNode;
}

const SELECT =
  "h-8 rounded border border-hub-border-strong bg-hub-surface px-2 font-hub text-sm " +
  "text-hub-ink pointer-coarse:h-11 focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-hub-accent";

const LINK =
  "inline-flex h-8 items-center rounded px-3 font-hub text-sm font-semibold text-hub-ink " +
  "hover:bg-hub-surface-2 pointer-coarse:min-h-11 focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

function current(field: FilterField): string {
  const v = field.value ?? "";
  return field.options.some((o) => o.value === v) ? v : "";
}

export function clearFiltersHref(
  action: string,
  hidden: Readonly<Record<string, string>> = {},
): string {
  const qs = new URLSearchParams(hidden).toString();
  return qs ? `${action}?${qs}` : action;
}

function submitWithoutEmpties(e: FormEvent<HTMLFormElement>): void {
  const form = e.currentTarget;
  const off: (HTMLInputElement | HTMLSelectElement)[] = [];
  for (const el of Array.from(form.elements)) {
    if (
      (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) &&
      el.name &&
      el.value === "" &&
      !el.disabled
    ) {
      el.disabled = true;
      off.push(el);
    }
  }
  // The GET navigation reads the form synchronously; re-enable for back/forward cache.
  setTimeout(() => {
    for (const el of off) el.disabled = false;
  }, 0);
}

export function FilterBar({
  action,
  filters,
  search,
  hidden = {},
  resultLine,
  children,
}: FilterBarProps) {
  const anySet =
    filters.some((f) => current(f) !== "") ||
    Boolean(search && (search.value ?? "").trim() !== "");
  const searchId = search ? `staff-filter-${search.name}` : undefined;
  return (
    <div className="flex flex-col gap-2 font-hub">
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-hub-surface-2 p-2">
        {children}
        <form
          method="get"
          action={action}
          role="search"
          onSubmit={submitWithoutEmpties}
          className="flex flex-wrap items-center gap-2"
        >
          {Object.entries(hidden).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          {search ? (
            <span className="flex items-center gap-1">
              <label htmlFor={searchId} className="text-sm text-hub-ink">
                {search.label}
              </label>
              <input
                id={searchId}
                type="search"
                name={search.name}
                defaultValue={search.value ?? ""}
                aria-describedby={
                  search.helper ? `${searchId}-help` : undefined
                }
                className={`${SELECT} w-48`}
              />
              {search.helper ? (
                <span id={`${searchId}-help`} className="sr-only">
                  {search.helper}
                </span>
              ) : null}
            </span>
          ) : null}
          {filters.map((f) => {
            const id = `staff-filter-${f.name}`;
            return (
              <span key={f.name} className="flex items-center gap-1">
                <label htmlFor={id} className="text-sm text-hub-ink">
                  {f.label}
                </label>
                <select
                  id={id}
                  name={f.name}
                  defaultValue={current(f)}
                  onChange={(e) => e.currentTarget.form?.requestSubmit()}
                  className={SELECT}
                >
                  <option value="">{C.any}</option>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </span>
            );
          })}
          <button type="submit" className={`sr-only focus:not-sr-only ${LINK}`}>
            {C.applyFilters}
          </button>
        </form>
        {anySet ? (
          <a href={clearFiltersHref(action, hidden)} className={LINK}>
            {C.clearFilters}
          </a>
        ) : null}
      </div>
      <p
        aria-live="polite"
        className="min-h-5 text-sm text-hub-ink-muted tabular-nums"
      >
        {resultLine ?? ""}
      </p>
    </div>
  );
}

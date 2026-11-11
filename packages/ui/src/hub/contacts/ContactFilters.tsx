"use client";
// Contacts filters row (07-16; CONTACTS-01/02, D-UI-P7-21; 07-UI-SPEC "Contacts" filters).
// A GET form (`/hub/marketing`, hidden tab=contacts) so it works without JS: search "Search
// name, email or phone" · Source · Tag (from used tags; hidden when none) · Newsletter · and a
// List select only when the org has 2+ lists (none in v1.0). With JS, a select change calls
// onChange(patch) at once and the search after a 300ms pause; ghost "Clear filters" shows
// only while a filter is set. The URL stays the source of truth (the app replaces it).
import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../Button";
import {
  CLEAR_FILTERS,
  NEWSLETTER_FILTER_OPTIONS,
  SEARCH_PLACEHOLDER,
  SOURCE_FILTER_OPTIONS,
  type ContactListView,
} from "./copy";

export type ContactFilterValues = {
  q?: string;
  source?: string;
  tag?: string;
  consent?: string;
  list?: string;
  sort?: string;
};

export type ContactFilterPatch = {
  q?: string | null;
  source?: string | null;
  tag?: string | null;
  consent?: string | null;
  list?: string | null;
};

export interface ContactFiltersProps {
  values: ContactFilterValues;
  tags: readonly string[];
  lists: readonly ContactListView[];
  onChange: (patch: ContactFilterPatch) => void;
  /** Where the no-JS GET form submits. */
  action?: string;
}

export const SEARCH_DEBOUNCE_MS = 300;

const SELECT =
  "h-10 rounded border border-hub-border-strong bg-hub-surface px-3 font-hub text-base " +
  "text-hub-ink transition-colors duration-150 hover:border-hub-ink-muted pointer-coarse:h-11";

function FilterSelect({
  id,
  label,
  name,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  name: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold text-hub-ink">
        {label}
      </label>
      <select
        id={id}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={SELECT}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ContactFilters({
  values,
  tags,
  lists,
  onChange,
  action = "/hub/marketing",
}: ContactFiltersProps) {
  const [q, setQ] = useState(values.q ?? "");
  const [seenQ, setSeenQ] = useState(values.q ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The URL changed under us (Clear filters, Back): show its search text.
  if ((values.q ?? "") !== seenQ) {
    setSeenQ(values.q ?? "");
    setQ(values.q ?? "");
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

  const active = Boolean(
    values.q || values.source || values.tag || values.consent || values.list,
  );
  const showList = lists.length >= 2;
  // No `list` in the URL means the house list (D-UI-P7-21).
  const houseId = lists.find((l) => l.kind === "house")?.id ?? "";
  const tagOptions = [
    { value: "", label: "All tags" },
    ...tags.map((t) => ({ value: t, label: t })),
  ];
  // A tag in the URL that no visible contact uses any more still shows as chosen.
  if (values.tag && !tags.includes(values.tag)) {
    tagOptions.push({ value: values.tag, label: values.tag });
  }

  return (
    <form
      method="get"
      action={action}
      role="search"
      aria-label="Filter contacts"
      onSubmit={(e) => {
        e.preventDefault();
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        onChange({ q: q.trim() || null });
      }}
      className="flex flex-col gap-4 font-hub md:flex-row md:flex-wrap md:items-end"
    >
      <input type="hidden" name="tab" value="contacts" />
      {values.sort ? (
        <input type="hidden" name="sort" value={values.sort} />
      ) : null}
      <div className="flex min-w-0 flex-col gap-1 md:w-72">
        <label
          htmlFor="contacts-search"
          className="text-sm font-semibold text-hub-ink"
        >
          Search
        </label>
        <div className="relative">
          <Search
            aria-hidden
            size={16}
            strokeWidth={2}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-hub-ink-muted"
          />
          <input
            id="contacts-search"
            type="search"
            name="q"
            value={q}
            maxLength={100}
            placeholder={SEARCH_PLACEHOLDER}
            onChange={(e) => typed(e.target.value)}
            className={`${SELECT} w-full pl-9 placeholder:text-hub-ink-muted`}
          />
        </div>
      </div>
      <FilterSelect
        id="contacts-source"
        label="Source"
        name="source"
        value={values.source ?? ""}
        options={SOURCE_FILTER_OPTIONS}
        onChange={(v) => onChange({ source: v || null })}
      />
      {tags.length > 0 || values.tag ? (
        <FilterSelect
          id="contacts-tag"
          label="Tag"
          name="tag"
          value={values.tag ?? ""}
          options={tagOptions}
          onChange={(v) => onChange({ tag: v || null })}
        />
      ) : null}
      <FilterSelect
        id="contacts-newsletter"
        label="Newsletter"
        name="newsletter"
        value={values.consent ?? ""}
        options={NEWSLETTER_FILTER_OPTIONS}
        onChange={(v) => onChange({ consent: v || null })}
      />
      {showList ? (
        <FilterSelect
          id="contacts-list"
          label="List"
          name="list"
          value={values.list ?? houseId}
          options={lists.map((l) => ({ value: l.id, label: l.name }))}
          onChange={(v) => onChange({ list: v && v !== houseId ? v : null })}
        />
      ) : null}
      <noscript>
        <Button type="submit">Apply filters</Button>
      </noscript>
      {active ? (
        <Button
          variant="ghost"
          onClick={() => {
            if (timer.current) clearTimeout(timer.current);
            timer.current = null;
            setQ("");
            onChange({
              q: null,
              source: null,
              tag: null,
              consent: null,
              list: null,
            });
          }}
        >
          {CLEAR_FILTERS}
        </Button>
      ) : null}
    </form>
  );
}

"use client";
// Section 1 path cards (ONB-11; UI-SPEC "Section 1 · Your path", Accessibility; D-UI-P6-5).
// A radiogroup of large cards with roving tabindex: arrows move focus, Space/Enter picks.
// Selected = 2px accent border + accent tint + Check icon + aria-checked (never colour
// alone). Paths come from PATHS: unavailable ones render as one plain line, not a card.
import type { AddonPath } from "@cds/core/addons";
import type { PathInfo } from "@cds/core/onboarding";
import type { CatalogRow } from "@cds/core/pricing";
import { Check } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { pathPriceLine, rovingIndex } from "./start-logic";

export interface PathChoiceProps {
  labelledBy: string;
  paths: readonly PathInfo[];
  catalog: readonly CatalogRow[] | null;
  value: AddonPath | "";
  onChange: (path: AddonPath) => void;
}

export function PathChoice({
  labelledBy,
  paths,
  catalog,
  value,
  onChange,
}: PathChoiceProps) {
  const available = paths.filter((p) => p.available);
  const soon = paths.filter((p) => !p.available);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIdx = available.findIndex((p) => p.id === value);
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  const tabStop = focusIdx ?? (selectedIdx >= 0 ? selectedIdx : 0);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const next = rovingIndex(i, e.key, available.length);
    if (next === null) return;
    e.preventDefault();
    setFocusIdx(next);
    refs.current[next]?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        role="radiogroup"
        aria-labelledby={labelledBy}
        className="grid gap-4 md:grid-cols-2"
      >
        {available.map((p, i) => {
          const selected = p.id === value;
          const price = pathPriceLine(catalog, p.id);
          return (
            <button
              key={p.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              data-value={p.id}
              tabIndex={i === tabStop ? 0 : -1}
              onClick={() => onChange(p.id)}
              onFocus={() => setFocusIdx(i)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={
                "relative flex min-h-44 flex-col items-start gap-2 rounded-lg text-left " +
                "transition-colors duration-150 motion-reduce:transition-none " +
                (selected
                  ? "border-2 border-hub-accent bg-hub-accent-tint p-[23px]"
                  : "border border-hub-border bg-hub-surface p-6 hover:border-hub-border-strong")
              }
            >
              {selected ? (
                <Check
                  aria-hidden
                  size={20}
                  strokeWidth={2}
                  className="absolute top-6 right-6 text-hub-accent"
                />
              ) : null}
              <span className="pr-8 text-xl leading-tight font-semibold">
                {p.label}
              </span>
              <span className="text-base">{p.whoFor}</span>
              <span className="text-sm text-hub-ink-muted">{p.examples}</span>
              {price ? (
                <span className="mt-auto pt-2 text-base font-semibold tabular-nums">
                  {price}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {soon.map((p) => (
        <p key={p.id} className="text-sm text-hub-ink-muted">
          {p.whoFor} A {p.label} plan is coming soon.
        </p>
      ))}
    </div>
  );
}

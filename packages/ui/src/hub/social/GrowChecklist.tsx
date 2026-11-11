"use client";
// Grow your social (11-37 choice 4; DASH-16, D200; 11-UI-SPEC lines 836-844).
// Heading + Label "4 of 12 done" + GROW-INTRO. Groups: Every account first, then one group
// per added platform (Label 600 name with brand icon 16), tips filtered by the business
// category (growTipsFor). Each row is a native checkbox (44px) that saves on change (per site;
// polite "Saved"); a failed save reverts the tick and shows ERR-SAVE. Ticked rows stay in
// place. No accounts yet: Every account only + "Add an account above to see tips for it."
// Read-only members see the ticks, disabled. Free tips only: no AI post ideas here.
import { findPreset, growTipsFor, type GrowTip } from "@cds/core/social";
import { useId, useState } from "react";
import type { HubActionResult } from "../addon-types";
import { PlatformIcon } from "./AddSocialAccount";
import { GROW_COPY as C, growDoneCopy } from "./copy";

export interface GrowChecklistProps {
  /** Platforms of the site's accounts, in list order (custom ones are ignored). */
  platforms: readonly string[];
  /** Business category (GrowCategory) from the intake business type. */
  category: string;
  ticks: readonly string[];
  canEdit: boolean;
  onToggle(
    tipId: string,
    on: boolean,
  ): Promise<HubActionResult<{ ticks: string[] }>>;
}

type Group = { key: string; label: string; tips: GrowTip[] };

export function growGroups(
  platforms: readonly string[],
  category: string,
): Group[] {
  const tips = growTipsFor(platforms, category);
  const order = ["all", ...new Set(platforms.filter((p) => findPreset(p)))];
  return order
    .map((key) => ({
      key,
      label: key === "all" ? C.everyAccount : (findPreset(key)?.label ?? key),
      tips: tips.filter((t) => t.platform === key),
    }))
    .filter((g) => g.tips.length > 0);
}

export function GrowChecklist({
  platforms,
  category,
  ticks: initial,
  canEdit,
  onToggle,
}: GrowChecklistProps) {
  const headingId = useId();
  const [ticks, setTicks] = useState<ReadonlySet<string>>(new Set(initial));
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const groups = growGroups(platforms, category);
  const shown = groups.flatMap((g) => g.tips);
  const done = shown.filter((t) => ticks.has(t.id)).length;
  const hasPlatforms = platforms.some((p) => findPreset(p));

  const toggle = async (tipId: string, on: boolean) => {
    const before = ticks;
    const next = new Set(before);
    if (on) next.add(tipId);
    else next.delete(tipId);
    setTicks(next);
    setError(null);
    setStatus("");
    try {
      const res = await onToggle(tipId, on);
      if (!res.ok) throw new Error(res.message);
      setStatus(C.saved);
    } catch {
      setTicks((cur) => {
        const back = new Set(cur);
        if (before.has(tipId)) back.add(tipId);
        else back.delete(tipId);
        return back;
      });
      setError(C.errSave);
    }
  };

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id={headingId}
            className="font-hub text-xl font-semibold text-hub-ink"
          >
            {C.heading}
          </h2>
          <span
            className="font-hub text-sm text-hub-ink-muted tabular-nums"
            data-grow-done
          >
            {growDoneCopy(done, shown.length)}
          </span>
        </div>
        <p className="max-w-[68ch] font-hub text-base text-hub-ink">
          {C.intro}
        </p>
      </div>
      {groups.map((g) => (
        <div
          key={g.key}
          className="flex flex-col gap-1"
          data-grow-group={g.key}
        >
          <p className="inline-flex items-center gap-2 font-hub text-sm font-semibold text-hub-ink">
            {g.key === "all" ? null : (
              <PlatformIcon platform={g.key} size={16} />
            )}
            {g.label}
          </p>
          <ul className="flex flex-col">
            {g.tips.map((t) => {
              const id = `${headingId}-${t.id}`;
              return (
                <li key={t.id} className="flex min-h-11 items-center gap-3">
                  <input
                    id={id}
                    type="checkbox"
                    className="h-5 w-5 shrink-0 accent-hub-accent"
                    checked={ticks.has(t.id)}
                    disabled={!canEdit}
                    data-tip={t.id}
                    onChange={(e) => void toggle(t.id, e.target.checked)}
                  />
                  <label
                    htmlFor={id}
                    className="font-hub text-base text-hub-ink"
                  >
                    {t.text}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {!hasPlatforms ? (
        <p className="font-hub text-sm text-hub-ink-muted">{C.noAccounts}</p>
      ) : null}
      {error ? (
        <p role="alert" className="font-hub text-sm text-hub-danger">
          {error}
        </p>
      ) : null}
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
    </section>
  );
}

"use client";
// QuietHoursForm (11-24; DASH-36, D313; 11-UI-SPEC "Profile" § 3 Quiet hours, lines 389-391;
// QUIET-HELP). Switch "Hold phone alerts at night" (on by default) and two Selects From / Until
// in 30-minute steps (default 9:00 pm / 7:00 am), with QUIET-HELP naming the business time
// zone. Every change autosaves the whole window (the latest wins); the selects stay visible
// but read-only while the switch is off. Bell and email are never held.
import { useId, useState } from "react";
import type { HubActionResult } from "../addon-types";
import { AutosaveStatus } from "../AutosaveStatus";
import { Select } from "../fields";
import { Switch } from "../Switch";
import { useAutosave } from "../useAutosave";
import { PROFILE_COPY as C, halfHourOptions, quietHelpCopy } from "./copy";

export type QuietHoursValue = { on: boolean; from: string; until: string };

export interface QuietHoursFormProps {
  initial: QuietHoursValue;
  /** "Central Time" (or the zone id when it has no name). */
  zoneLabel: string;
  disabled?: boolean;
  onSave(value: QuietHoursValue): Promise<HubActionResult<unknown>>;
}

const OPTIONS = halfHourOptions();

export function QuietHoursForm({
  initial,
  zoneLabel,
  disabled = false,
  onSave,
}: QuietHoursFormProps) {
  const uid = useId();
  const [value, setValue] = useState<QuietHoursValue>(initial);
  const save = useAutosave<QuietHoursValue>(onSave);

  function change(patch: Partial<QuietHoursValue>) {
    if (disabled) return;
    const next = { ...value, ...patch };
    setValue(next);
    save.run(next);
  }

  const headingId = `${uid}-quiet`;
  const helpId = `${uid}-quiet-help`;
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 font-hub text-hub-ink"
      data-profile-quiet=""
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <h2 id={headingId} className="text-xl leading-tight font-semibold">
          {C.quiet}
        </h2>
        <AutosaveStatus state={save.status} onRetry={save.retry} />
      </div>
      <Switch
        id={`${uid}-quiet-on`}
        label={C.quietSwitch}
        checked={value.on}
        disabled={disabled}
        aria-describedby={helpId}
        onChange={(on) => change({ on })}
      />
      <div className="grid max-w-md grid-cols-2 gap-4">
        <Select
          id={`${uid}-quiet-from`}
          label={C.from}
          options={OPTIONS}
          value={value.from}
          disabled={disabled || !value.on}
          onChange={(e) => change({ from: e.currentTarget.value })}
        />
        <Select
          id={`${uid}-quiet-until`}
          label={C.until}
          options={OPTIONS}
          value={value.until}
          disabled={disabled || !value.on}
          onChange={(e) => change({ until: e.currentTarget.value })}
        />
      </div>
      <p id={helpId} className="text-sm text-hub-ink-muted">
        {quietHelpCopy(zoneLabel)}
      </p>
    </section>
  );
}

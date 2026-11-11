"use client";
// "Opening hours" (06-19; 06-UI-SPEC "Hours editor"; ONB-13, D257, D-UI-P6-22, D-UI-P6-23).
// Wraps the shared HoursEditor and saves the week as one value, debounced 800ms, through the
// host's onSave({ hours }) (saveProfileAction(stage, { hours }) in setup), where the
// chokepoint runs validateHours again. A row the client check refuses is shown under its row,
// marks the step "needs attention" and is not sent. All days closed saves null: the site then
// says "Contact us for hours". Reused by Settings (06-22).
import { DAYS, type WeeklyHours } from "@cds/core/intake";
import { HoursEditor, hoursRowErrors } from "@cds/ui/hub";
import { useState } from "react";
import { useStageInvalid } from "../setup/[stage]/StageFrame";
import { FieldGroup } from "./FieldGroup";
import { OPTIONAL } from "./BusinessInfoFields";
import { useProfileField, type ProfileSave } from "./useProfileField";

export const HOURS_DEBOUNCE_MS = 800;

export interface HoursSectionProps {
  hours: WeeklyHours | null;
  timeZone: string;
  readOnly: boolean;
  onSave: ProfileSave;
  /** Where the time zone is edited. */
  timeZoneHref?: string;
}

export function HoursSection({
  hours: initial,
  timeZone,
  readOnly,
  onSave,
  timeZoneHref = "#field-time_zone",
}: HoursSectionProps) {
  const [hours, setHours] = useState<WeeklyHours | null>(initial);
  const [invalid, setInvalid] = useState(false);
  const save = useProfileField("hours", initial, onSave, {
    debounceMs: HOURS_DEBOUNCE_MS,
  });
  useStageInvalid("local.hours", invalid);

  return (
    <FieldGroup id="group-hours" title="Opening hours" titleExtra={OPTIONAL}>
      <HoursEditor
        value={hours}
        timeZone={timeZone}
        timeZoneHref={timeZoneHref}
        readOnly={readOnly}
        onChange={(next) => {
          setHours(next);
          const bad = Object.keys(hoursRowErrors(next)).length > 0;
          setInvalid(bad);
          if (bad) return;
          const anyOpen = DAYS.some((d) => next[d].open);
          save.save(anyOpen ? next : null);
        }}
      />
      {save.error ? (
        <p className="text-sm text-hub-danger">{save.error}</p>
      ) : null}
    </FieldGroup>
  );
}

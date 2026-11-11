"use client";
// HoursEditor (07-24; CONT-27, D257, D119; 07-UI-SPEC row "Business hours"; D311 admin
// pattern; replaces the 07-07 stub body, name and BUILDER_BLOCKS_B entry kept). Never
// exported from the @cds/ui/builder barrel (the hub has its own HoursEditor).
//
// Heading (default "Opening hours") · Show "Open now" · an info InlineAlert saying the hours
// come from Settings › Team & hours with an Edit your hours link; with no hours set, a line
// telling the owner what visitors will see. Background stays in SectionForm.
import { useId } from "react";
import { TextField } from "../../hub/fields";
import { InlineAlert } from "../../hub/feedback";
import { Switch } from "../../hub/Switch";
import {
  SETTINGS_LINK_CLASS,
  TEAM_HOURS_HREF,
  useBuilderBusiness,
} from "./business-context";
import type { CoreBlockEditorProps } from "./types";

export function HoursEditor({
  content,
  onChange,
  errors,
}: CoreBlockEditorProps) {
  const uid = useId();
  const business = useBuilderBusiness();
  const heading =
    typeof content.heading === "string" ? content.heading : "Opening hours";
  const showOpenNow = content.show_open_now !== false;
  const noHours = business !== null && !business.hasHours;

  return (
    <div className="flex flex-col gap-6 font-hub">
      <TextField
        id={`${uid}-heading`}
        label="Heading"
        value={heading}
        error={errors.heading}
        onChange={(e) => onChange("heading", e.currentTarget.value)}
      />
      <Switch
        id={`${uid}-open-now`}
        label={'Show "Open now"'}
        checked={showOpenNow}
        onChange={(v) => onChange("show_open_now", v)}
      />
      <InlineAlert tone="info">
        <p>
          Hours come from Settings › Team & hours.{" "}
          <a href={TEAM_HOURS_HREF} className={SETTINGS_LINK_CLASS}>
            Edit your hours
          </a>
        </p>
        {noHours ? (
          <p className="mt-1">
            No hours yet. Visitors will see &apos;Contact us for hours.&apos;
          </p>
        ) : null}
      </InlineAlert>
    </div>
  );
}

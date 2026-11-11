"use client";
// TeamEditor (08-05; TMPL-01, TMPL-02, D257, D119; 08-UI-SPEC "Our team block" builder
// form; D311 admin pattern). Never exported from the @cds/ui/builder barrel.
//
// Info alert first (TEAM-SOURCE + Edit your team, same tab), then Heading · Show roles ·
// Show bios. Background stays in SectionForm.
import { useId } from "react";
import { TextField } from "../../hub/fields";
import { InlineAlert } from "../../hub/feedback";
import { Switch } from "../../hub/Switch";
import { SETTINGS_LINK_CLASS, TEAM_HOURS_HREF } from "./business-context";
import type { CoreBlockEditorProps } from "./types";

/** UI-SPEC TEAM-SOURCE. */
const TEAM_SOURCE =
  "Team members come from Settings › Team & hours. Members you hide there don't show.";

export function TeamEditor({
  content,
  onChange,
  errors,
}: CoreBlockEditorProps) {
  const uid = useId();
  const heading =
    typeof content.heading === "string" ? content.heading : "Our team";

  return (
    <div className="flex flex-col gap-6 font-hub">
      <InlineAlert tone="info">
        <p>
          {TEAM_SOURCE}{" "}
          <a href={TEAM_HOURS_HREF} className={SETTINGS_LINK_CLASS}>
            Edit your team
          </a>
        </p>
      </InlineAlert>
      <TextField
        id={`${uid}-heading`}
        label="Heading"
        value={heading}
        error={errors.heading}
        onChange={(e) => onChange("heading", e.currentTarget.value)}
      />
      <Switch
        id={`${uid}-roles`}
        label="Show roles"
        checked={content.show_roles !== false}
        onChange={(v) => onChange("show_roles", v)}
      />
      <Switch
        id={`${uid}-bios`}
        label="Show bios"
        checked={content.show_bios !== false}
        onChange={(v) => onChange("show_bios", v)}
      />
    </div>
  );
}

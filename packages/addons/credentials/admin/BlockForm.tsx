"use client";
// Credentials block form (05-UI-SPEC "Builder integration"; AddonBlockFormProps). The P3
// builder owns Background and Save block; this form sets Heading and Group by category
// through onChange(name, value), which the section validator checks again on save.
import { Switch, TextField, type AddonBlockFormProps } from "@cds/ui/hub";
import Link from "next/link";
import { useId } from "react";
import { HEADING_MAX } from "../sections/definition";
import { BLOCK_FORM } from "./copy";

export function BlockForm({
  content,
  onChange,
  errors,
  editHref,
}: AddonBlockFormProps) {
  const uid = useId();
  const heading = typeof content.heading === "string" ? content.heading : "";
  const grouped = content.group_by_category !== false;

  return (
    <div className="flex flex-col gap-6 font-hub text-hub-ink">
      <p className="text-sm text-hub-ink-muted">
        {BLOCK_FORM.editPrefix}{" "}
        <Link
          href={editHref}
          className="text-hub-accent underline underline-offset-2"
        >
          {BLOCK_FORM.editLink}
        </Link>
        .
      </p>
      <TextField
        id={`${uid}-heading`}
        label={BLOCK_FORM.heading}
        value={heading}
        maxLength={HEADING_MAX}
        error={errors.heading}
        onChange={(e) => onChange("heading", e.target.value)}
      />
      <div className="flex flex-col gap-1">
        <Switch
          id={`${uid}-group`}
          label={BLOCK_FORM.groupByCategory}
          checked={grouped}
          aria-describedby={`${uid}-group-help`}
          onChange={(v) => onChange("group_by_category", v)}
        />
        <p id={`${uid}-group-help`} className="text-sm text-hub-ink-muted">
          {BLOCK_FORM.groupHelper}
        </p>
      </div>
    </div>
  );
}

"use client";
// Testimonials block form (05-UI-SPEC "Builder integration"; AddonBlockFormProps). The P3
// builder owns Background and Save block; this form sets the block's own settings through
// onChange(name, value), which the section validator clamps again on save (T-05-35).
import {
  LayoutThumb,
  RadioCardGroup,
  TextField,
  type AddonBlockFormProps,
} from "@cds/ui/hub";
import Link from "next/link";
import { useId, useState } from "react";
import {
  HEADING_MAX,
  LIMIT_DEFAULT,
  LIMIT_MAX,
  LIMIT_MIN,
  type TestimonialsLayout,
  type TestimonialsShow,
} from "../sections/definition";
import { BLOCK_FORM } from "./copy";

function limitOf(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : LIMIT_DEFAULT;
}

/** A whole number from 1 to 12 typed so far, else null (still typing, or out of range). */
export function parseLimit(raw: string): number | null {
  if (!/^\s*\d+\s*$/.test(raw)) return null;
  const n = Number(raw);
  return n >= LIMIT_MIN && n <= LIMIT_MAX ? n : null;
}

/** On blur: empty reads as the default; anything else is rounded and clamped to 1..12. */
export function settleLimit(raw: string): number {
  const n = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(n)) return LIMIT_DEFAULT;
  return Math.min(LIMIT_MAX, Math.max(LIMIT_MIN, Math.round(n)));
}

/**
 * "How many" keeps its own text while the owner types (B-WR-08): clearing the field to type
 * "3" no longer snaps it back to 6. A value in range is sent as it is typed; the rest settles
 * on blur. The section validator (clampLimit) stays the server-side authority.
 */
function LimitField({
  id,
  value,
  error,
  onCommit,
}: {
  id: string;
  value: number;
  error?: string;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    // The block changed outside this field (undo, another block): show the new value.
    setSynced(value);
    setDraft(String(value));
  }
  return (
    <TextField
      id={id}
      label={BLOCK_FORM.howMany}
      type="number"
      inputMode="numeric"
      min={LIMIT_MIN}
      max={LIMIT_MAX}
      step={1}
      value={draft}
      helper={BLOCK_FORM.howManyHelper}
      error={error}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const n = parseLimit(raw);
        if (n !== null && n !== value) onCommit(n);
      }}
      onBlur={() => {
        const n = settleLimit(draft);
        setDraft(String(n));
        if (n !== value) onCommit(n);
      }}
    />
  );
}

export function BlockForm({
  content,
  onChange,
  errors,
  editHref,
}: AddonBlockFormProps) {
  const uid = useId();
  const layout: TestimonialsLayout =
    content.layout === "single" ? "single" : "grid";
  const show: TestimonialsShow =
    content.show === "featured" ? "featured" : "all";
  const heading = typeof content.heading === "string" ? content.heading : "";

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
      <RadioCardGroup<TestimonialsLayout>
        name={`${uid}-layout`}
        legend={BLOCK_FORM.layout}
        value={layout}
        onChange={(v) => onChange("layout", v)}
        options={[
          {
            value: "grid",
            title: BLOCK_FORM.grid,
            description: BLOCK_FORM.gridDescription,
            adornment: (
              <span aria-hidden>
                <LayoutThumb layout="33-33-33" selected={layout === "grid"} />
              </span>
            ),
          },
          {
            value: "single",
            title: BLOCK_FORM.single,
            description: BLOCK_FORM.singleDescription,
            adornment: (
              <span aria-hidden>
                <LayoutThumb layout="full" selected={layout === "single"} />
              </span>
            ),
          },
        ]}
      />
      <RadioCardGroup<TestimonialsShow>
        name={`${uid}-show`}
        legend={BLOCK_FORM.show}
        value={show}
        onChange={(v) => onChange("show", v)}
        options={[
          { value: "all", title: BLOCK_FORM.showAll },
          { value: "featured", title: BLOCK_FORM.showFeatured },
        ]}
      />
      {layout === "grid" ? (
        <LimitField
          id={`${uid}-limit`}
          value={limitOf(content.limit)}
          error={errors.limit}
          onCommit={(n) => onChange("limit", n)}
        />
      ) : (
        <p className="text-sm text-hub-ink-muted">{BLOCK_FORM.singleHelper}</p>
      )}
    </div>
  );
}

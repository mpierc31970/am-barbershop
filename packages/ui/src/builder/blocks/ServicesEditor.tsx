"use client";
// ServicesEditor (08-05; TMPL-01, TMPL-02, D37, D119, D-UI-P8-15; 08-UI-SPEC "Services
// block" builder form; D311 admin pattern). Never exported from the @cds/ui/builder barrel.
//
// Info alert first (SERVICES-SOURCE + Edit services, same tab), then the count line when
// the builder knows how many services are published (BuilderBusiness.publishedServices,
// filled by the builder route in 08-08; absent -> no line). Then Heading · Display (List /
// Cards, drawn thumbs) · How many to show (All, 3, 6, 9, 12; All = 0) · Show descriptions ·
// Show how long each takes. Background stays in SectionForm.
import { SERVICES_LIMITS } from "@cds/core/content";
import { useId } from "react";
import { Select, TextField } from "../../hub/fields";
import { InlineAlert } from "../../hub/feedback";
import { RadioCardGroup } from "../../hub/RadioCardGroup";
import { Switch } from "../../hub/Switch";
import {
  SERVICES_HREF,
  SETTINGS_LINK_CLASS,
  useBuilderBusiness,
} from "./business-context";
import type { CoreBlockEditorProps } from "./types";

type Display = "list" | "cards";

/** UI-SPEC SERVICES-SOURCE. */
const SERVICES_SOURCE =
  "Services come from Website › Services, so changes there show here right away.";

/** UI-SPEC "Services count label". */
export function servicesCountLine(published: number, limit: number): string {
  if (published <= 0) return "No services are showing yet.";
  if (limit === 0 || limit >= published) {
    return `Showing all ${published} services on your site.`;
  }
  return `Showing ${limit} of ${published} services on your site.`;
}

/** Small drawn previews for the Display cards (CSS boxes, no images). */
function DisplayThumb({ display }: { display: Display }) {
  const box = "rounded-sm bg-hub-border-strong";
  if (display === "list") {
    return (
      <span aria-hidden className="flex h-8 w-12 flex-col justify-between">
        {Array.from({ length: 4 }, (_, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className={`${box} h-1 flex-1`} />
            <span className={`${box} h-1 w-2`} />
          </span>
        ))}
      </span>
    );
  }
  return (
    <span aria-hidden className="grid h-8 w-12 grid-cols-3 gap-0.5">
      {Array.from({ length: 3 }, (_, i) => (
        <span key={i} className={box} />
      ))}
    </span>
  );
}

const DISPLAY_OPTIONS = [
  {
    value: "list" as const,
    title: "List",
    description: "A price list, one row each",
    adornment: <DisplayThumb display="list" />,
  },
  {
    value: "cards" as const,
    title: "Cards",
    description: "A card for each service",
    adornment: <DisplayThumb display="cards" />,
  },
];

const LIMIT_OPTIONS = SERVICES_LIMITS.map((n) => ({
  value: String(n),
  label: n === 0 ? "All" : String(n),
}));

export function ServicesEditor({
  content,
  onChange,
  errors,
}: CoreBlockEditorProps) {
  const uid = useId();
  const business = useBuilderBusiness();
  const heading =
    typeof content.heading === "string" ? content.heading : "Services";
  const display: Display = content.display === "list" ? "list" : "cards";
  const limit = (SERVICES_LIMITS as readonly unknown[]).includes(content.limit)
    ? (content.limit as number)
    : 0;
  const published = business?.publishedServices;
  const countLine =
    typeof published === "number" && Number.isFinite(published)
      ? servicesCountLine(published, limit)
      : null;

  return (
    <div className="flex flex-col gap-6 font-hub">
      <InlineAlert tone="info">
        <p>
          {SERVICES_SOURCE}{" "}
          <a href={SERVICES_HREF} className={SETTINGS_LINK_CLASS}>
            Edit services
          </a>
        </p>
        {countLine ? (
          <p className="mt-1 text-sm text-hub-ink-muted tabular-nums">
            {countLine}
          </p>
        ) : null}
      </InlineAlert>
      <TextField
        id={`${uid}-heading`}
        label="Heading"
        value={heading}
        error={errors.heading}
        onChange={(e) => onChange("heading", e.currentTarget.value)}
      />
      <RadioCardGroup<Display>
        name={`${uid}-display`}
        legend="Display"
        options={DISPLAY_OPTIONS}
        value={display}
        onChange={(v) => onChange("display", v)}
      />
      <Select
        id={`${uid}-limit`}
        label="How many to show"
        value={String(limit)}
        options={LIMIT_OPTIONS}
        onChange={(e) => onChange("limit", Number(e.currentTarget.value))}
      />
      <Switch
        id={`${uid}-descriptions`}
        label="Show descriptions"
        checked={content.show_descriptions !== false}
        onChange={(v) => onChange("show_descriptions", v)}
      />
      <Switch
        id={`${uid}-durations`}
        label="Show how long each takes"
        checked={content.show_durations !== false}
        onChange={(v) => onChange("show_durations", v)}
      />
    </div>
  );
}

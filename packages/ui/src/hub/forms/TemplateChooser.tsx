"use client";
// Template chooser (07-18; CONT-25, D231, D119; 07-UI-SPEC "Template chooser", &form=new).
// Heading "Start from a template", six radio cards (two columns from 768px) with each
// template's summary and its field labels, Contact selected by default, then Create form
// (the view's one primary, aria-busy while pending) and ghost Back to forms.
import { useState } from "react";
import { Button } from "../Button";
import { RadioCardGroup } from "../RadioCardGroup";
import {
  CREATE_FORM,
  NO_FIELDS_YET,
  TEMPLATE_HEADING,
  templateCards,
} from "./form-logic";

export interface TemplateChooserProps {
  onCreate: (template: string) => void;
  onBack: () => void;
  pending?: boolean;
}

export function TemplateChooser({
  onCreate,
  onBack,
  pending = false,
}: TemplateChooserProps) {
  const cards = templateCards();
  const [choice, setChoice] = useState("contact");
  return (
    <section
      aria-labelledby="template-heading"
      className="flex flex-col gap-6 font-hub"
    >
      <h2
        id="template-heading"
        className="text-xl leading-tight font-semibold text-hub-ink"
      >
        {TEMPLATE_HEADING}
      </h2>
      <RadioCardGroup
        name="form-template"
        legend={TEMPLATE_HEADING}
        hideLegend
        value={choice}
        onChange={setChoice}
        options={cards.map((c) => ({
          value: c.id,
          title: c.label,
          description: c.summary,
          body: (
            <span className="text-sm text-hub-ink-muted">
              {c.fieldLabels.length > 0
                ? c.fieldLabels.join(" · ")
                : NO_FIELDS_YET}
            </span>
          ),
        }))}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          loading={pending}
          loadingLabel="Creating…"
          onClick={() => onCreate(choice)}
        >
          {CREATE_FORM}
        </Button>
        <Button variant="ghost" onClick={onBack}>
          Back to forms
        </Button>
      </div>
    </section>
  );
}

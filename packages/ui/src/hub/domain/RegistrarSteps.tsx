"use client";
// RegistrarSteps (14-30 choice 3; 14-UI-SPEC "S2" zone file, "S3", "Leaving CDS" handback;
// D-UI-P14-8). A Select "Where is your domain registered?" preselected from RDAP and an <ol>
// of 3-5 Body steps for the choice, on a surface-2 panel. The step texts are data in
// `@cds/core/dns` (`registrarSteps`, 14-05): `**bold**` marks the words on the registrar's
// screen and renders as <strong> (text nodes only, never HTML). One list for all four kinds
// (nameservers, zone_export, dnssec, handback).
import {
  REGISTRARS,
  registrarSteps,
  type RegistrarId,
  type RegistrarStepKind,
} from "@cds/core/dns";
import { useId, useState, type ReactNode } from "react";
import { Select } from "../fields";
import { DOMAIN_UI_COPY as C } from "./copy";

export interface RegistrarStepsProps {
  kind: RegistrarStepKind;
  /** Preselected registrar (from RDAP); "other" when unknown. */
  registrar: RegistrarId;
  onChange?(id: RegistrarId): void;
}

/** Split "**bold**" marks into <strong> runs; everything stays a text node. */
export function renderStepText(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).flatMap((part, i): ReactNode[] => {
    if (!part) return [];
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return [
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>,
      ];
    }
    return [part];
  });
}

const OPTIONS = REGISTRARS.map((r) => ({ value: r.id, label: r.name }));

export function RegistrarSteps({
  kind,
  registrar,
  onChange,
}: RegistrarStepsProps) {
  const id = useId();
  const [current, setCurrent] = useState<RegistrarId>(registrar);
  const steps = registrarSteps(kind, current);
  return (
    <div
      data-registrar-steps={kind}
      className="flex flex-col gap-4 rounded-lg bg-hub-surface-2 p-6 font-hub text-hub-ink"
    >
      <div className="max-w-sm">
        <Select
          id={`${id}-registrar`}
          label={C.registrarSelect}
          options={OPTIONS}
          value={current}
          onChange={(e) => {
            const next = e.currentTarget.value as RegistrarId;
            setCurrent(next);
            onChange?.(next);
          }}
        />
      </div>
      <ol
        aria-live="polite"
        className="flex max-w-[68ch] list-decimal flex-col gap-2 pl-6 text-base"
      >
        {steps.map((s, i) => (
          <li key={`${current}-${i}`}>{renderStepText(s)}</li>
        ))}
      </ol>
    </div>
  );
}

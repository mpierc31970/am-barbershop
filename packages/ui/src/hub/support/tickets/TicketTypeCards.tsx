"use client";
// TicketTypeCards (12-10 choice 3; COMM-06, D94; 12-UI-SPEC Get help form lines 380-387, a11y
// "Type cards"). A native radio group drawn as cards (RadioCardGroup). The cards are the types
// this role may file (`ticketTypesFor`): Billing is simply absent for Editors, so the arrow-key
// order never has a gap. Suggest a feature is always last and spans both columns. Nothing is
// preselected unless the page passes a value (`?type=`). TYPE-REQUIRED is tied to the group
// (fieldset aria-describedby, radios aria-invalid) so revisiting it re-states the error
// (12-REVIEW IN-D07).
import { SUPPORT_COPY, type TicketType } from "@cds/core/support";
import { useId } from "react";
import { RadioCardGroup, type RadioCardOption } from "../../RadioCardGroup";
import { TICKETS_COPY } from "./copy";

export interface TicketTypeCardsProps {
  /** Types this person may file, from `ticketTypesFor(role)`. */
  types: readonly TicketType[];
  value: TicketType | null;
  onChange: (value: TicketType) => void;
  /** Radio group name (form field). Default "type". */
  name?: string;
  /** Hide the legend when a Heading above names the group. */
  hideLegend?: boolean;
  /** TYPE-REQUIRED, shown under the cards. */
  error?: string | null;
}

/** Card options in the fixed order, suggestion last and full width. */
export function ticketTypeOptions(
  types: readonly TicketType[],
): RadioCardOption<TicketType>[] {
  const order: TicketType[] = [
    "problem",
    "change",
    "question",
    "billing",
    "suggestion",
  ];
  return order
    .filter((t) => types.includes(t))
    .map((t) => ({
      value: t,
      title:
        t === "suggestion"
          ? TICKETS_COPY.suggestCard
          : SUPPORT_COPY.TYPE_LABELS[t],
      description: SUPPORT_COPY.TYPE_HINTS[t],
      className:
        t === "suggestion" ? "sm:col-span-2 min-h-[72px]" : "min-h-[72px]",
    }));
}

export function TicketTypeCards({
  types,
  value,
  onChange,
  name,
  hideLegend = false,
  error,
}: TicketTypeCardsProps) {
  const auto = useId();
  const groupName = name ?? `type-${auto.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const errorId = `${groupName}-error`;
  return (
    <div className="flex flex-col gap-2" data-ticket-types="">
      <RadioCardGroup<TicketType>
        name={groupName}
        legend={TICKETS_COPY.typeLegend}
        hideLegend={hideLegend}
        options={ticketTypeOptions(types)}
        value={value}
        onChange={onChange}
        describedBy={error ? errorId : undefined}
        invalid={!!error}
      />
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="font-hub text-sm text-hub-danger"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

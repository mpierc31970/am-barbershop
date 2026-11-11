"use client";
// PagePacksRemove (11-28; DASH-08, D185; UI-SPEC "Remove a page pack", Destructive actions
// table): the ghost sm "Remove one" under the "+5 pages × n" row of What you pay for. Refused
// in place (InlineAlert warning, no dialog) while the counted pages would not fit the allowance
// one pack less leaves (PAGES-PACK-REFUSED, built on the server); otherwise the P10 danger
// RemoveConfirmDialog with Keep pack focused. The server re-checks the refusal (removePack).
import { Button, InlineAlert } from "@cds/ui/hub";
import { RemoveConfirmDialog, type ChargeResult } from "@cds/ui/hub/billing";
import { useState } from "react";
import type { PagePacksView } from "../../../../lib/billing-view";

export const PAGE_PACK_REMOVE_COPY = {
  removeOne: "Remove one",
  title: "Remove a 5-page pack?",
  remove: "Remove pack",
  keep: "Keep pack",
} as const;

/** "You go from 15 pages to 10 and your bill drops by $10 a month, credited …". */
export function removePagesPackBody(
  allowance: number,
  drop: string | null,
): string {
  const to = Math.max(0, allowance - 5);
  return drop
    ? `You go from ${allowance} pages to ${to} and your bill drops by ${drop} a month, credited for the rest of this month.`
    : `You go from ${allowance} pages to ${to} and your bill goes down, credited for the rest of this month.`;
}

export interface PagePacksRemoveProps {
  view: PagePacksView;
  onRemove: () => Promise<ChargeResult>;
}

export function PagePacksRemove({ view, onRemove }: PagePacksRemoveProps) {
  const [open, setOpen] = useState(false);
  const [refused, setRefused] = useState(false);

  const ask = () => {
    if (view.removeRefusal) {
      setRefused(true);
      return;
    }
    setRefused(false);
    setOpen(true);
  };

  return (
    <div className="flex flex-col gap-2" data-page-packs-remove="">
      <div>
        <Button variant="ghost" size="sm" onClick={ask}>
          {PAGE_PACK_REMOVE_COPY.removeOne}
        </Button>
      </div>
      {refused && view.removeRefusal ? (
        <InlineAlert tone="warning">{view.removeRefusal}</InlineAlert>
      ) : null}
      <RemoveConfirmDialog
        open={open}
        title={PAGE_PACK_REMOVE_COPY.title}
        body={removePagesPackBody(view.allowance, view.dropLabel)}
        removeLabel={PAGE_PACK_REMOVE_COPY.remove}
        keepLabel={PAGE_PACK_REMOVE_COPY.keep}
        onRemove={onRemove}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}

"use client";
// Marketing › Social panel (11-37): My social accounts above Grow your social, sharing one
// list so the Grow groups follow accounts as they are added or removed. Content max-width
// 880px (11-UI-SPEC). Wired by apps/web SocialTab with server actions.
import type { SocialAccount } from "@cds/core/social";
import { useState } from "react";
import { GrowChecklist, type GrowChecklistProps } from "./GrowChecklist";
import { SocialAccountsList, type SocialActions } from "./SocialAccountsList";

export interface SocialPanelProps {
  accounts: readonly SocialAccount[];
  origin: string | null;
  preview: boolean;
  canEdit: boolean;
  actions: SocialActions;
  grow: {
    category: string;
    ticks: readonly string[];
    onToggle: GrowChecklistProps["onToggle"];
  };
}

export function SocialPanel({
  accounts,
  origin,
  preview,
  canEdit,
  actions,
  grow,
}: SocialPanelProps) {
  const [platforms, setPlatforms] = useState<string[]>(() =>
    accounts.map((a) => a.platform),
  );
  return (
    <div className="flex max-w-[880px] flex-col gap-10" data-social-panel>
      <SocialAccountsList
        accounts={accounts}
        origin={origin}
        preview={preview}
        canEdit={canEdit}
        actions={actions}
        onChange={(next) => setPlatforms(next.map((a) => a.platform))}
      />
      <GrowChecklist
        platforms={platforms}
        category={grow.category}
        ticks={grow.ticks}
        canEdit={canEdit}
        onToggle={grow.onToggle}
      />
    </div>
  );
}

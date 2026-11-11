"use client";
// Ideas tab (12-25 choice 3; CUSTOM-01, D297, D-UI-P12-20..22; 12-UI-SPEC Ideas tab lines
// 525-545). The client island under the server loader in page.tsx:
//   - IDEAS-INTRO, then the toolbar: Search ideas (filters as you type over the loaded list),
//     the Suggested · Considering · Planned · Built control (`?status=`, a server reload since
//     each status is its own list) and secondary Suggest a feature
//     (/hub/support/tickets/new?type=suggestion) for writers only.
//   - IdeaList ranked by votes then newest. Writers get the VoteButton toggle
//     (toggleIdeaVoteAction; a failure reverts the count and shows the ERR-VOTE toast);
//     Viewers and impersonating staff see counts only (the chokepoint refuses them too,
//     T-12-25-02).
//   - A merged idea's old link (`?idea=`) lands on its target with the merged notice; the
//     just-posted idea (`?new=`, 12-27) is highlighted for 2 s.
import type { IdeaCard } from "@cds/core/support";
import {
  buttonClasses,
  SegmentedControl,
  TextField,
  useToast,
} from "@cds/ui/hub";
import {
  IDEAS_COPY,
  IDEA_STATUSES,
  IdeaList,
  SUGGEST_IDEA_HREF,
  SUPPORT_UI_COPY,
  type IdeaStatus,
} from "@cds/ui/hub/support";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toggleIdeaVoteAction } from "../../../actions/support-lists";
import { GuardedLink } from "../GuardedLink";
import type { SupportAccess } from "./SupportFrame";
import { SUPPORT_COPY } from "./support-copy";

export interface IdeasPanelProps {
  /** Server-ranked ideas of `status`. */
  ideas: IdeaCard[];
  status: IdeaStatus;
  access: SupportAccess;
  timeZone: string;
  highlightId: string | null;
  mergedNotice: boolean;
}

export function ideasHref(status: IdeaStatus): string {
  return status === "suggested"
    ? "/hub/support?tab=ideas"
    : `/hub/support?tab=ideas&status=${status}`;
}

export function IdeasPanel({
  ideas,
  status,
  access,
  timeZone,
  highlightId,
  mergedNotice,
}: IdeasPanelProps) {
  const router = useRouter();
  const toast = useToast();
  const searchId = useId();
  const [query, setQuery] = useState("");
  const canVote = access === "write";

  async function onToggle(id: string): Promise<void> {
    const res = await toggleIdeaVoteAction(id);
    if (!res.ok) throw new Error(res.message);
  }

  return (
    <div className="flex flex-col gap-6" data-ideas-panel="">
      <p className="max-w-[68ch] text-sm text-hub-ink-muted">
        {SUPPORT_UI_COPY.IDEAS_INTRO}
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="sm:w-64">
          <TextField
            id={searchId}
            type="search"
            label={SUPPORT_COPY.ideasSearch}
            value={query}
            autoComplete="off"
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
        </div>
        <div className="w-full sm:w-fit">
          <SegmentedControl<IdeaStatus>
            name="ideas-status"
            label={SUPPORT_COPY.ideasStatusLabel}
            options={IDEA_STATUSES.map((s) => ({
              value: s,
              label: IDEAS_COPY.status[s],
            }))}
            value={status}
            onChange={(v) => router.replace(ideasHref(v), { scroll: false })}
          />
        </div>
        {canVote ? (
          <GuardedLink
            href={SUGGEST_IDEA_HREF}
            className={`${buttonClasses("secondary")} sm:ml-auto`}
            data-suggest-feature=""
          >
            {SUPPORT_UI_COPY.BUTTONS.suggestFeature}
          </GuardedLink>
        ) : null}
      </div>
      <IdeaList
        ideas={ideas}
        query={query}
        status={status}
        canVote={canVote}
        onToggle={(id) => onToggle(id)}
        onError={(message) => toast.show({ message })}
        timeZone={timeZone}
        highlightId={highlightId}
        mergedNotice={mergedNotice}
        suggestHref={canVote ? SUGGEST_IDEA_HREF : undefined}
        LinkComponent={GuardedLink}
      />
    </div>
  );
}

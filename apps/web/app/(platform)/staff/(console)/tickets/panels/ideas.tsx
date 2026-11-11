// Panel tickets/ideas: filled by 13-36
// Panel tickets/ideas (13-36 choices 3-4; P12 `ideas:run` in the console; 13-UI-SPEC "Ideas"
// lines 587-596). Reads every idea once (staffListIdeas with hidden and merged, as the CLI's
// findIdea does) and filters by `?view=` (suggested default · considering · planned · built ·
// hidden · merged). `?open=<id>` opens the idea drawer with the ideas it may merge into. The tab
// is gated on `ideas_run` (STAFF_SECTIONS). A failed read logs the class name only.
import { IDEA_HOLD_REVIEW, staffListIdeas, type StaffIdeaRow } from "@cds/db";
import type { StaffPanelProps } from "../../StaffAreaPage";
import { SitesLoadError } from "../../sites/SitesLoadError";
import {
  IdeaDrawer,
  IdeasList,
  type IdeaRowView,
  type IdeaView,
} from "../IdeasIsland";

const VIEWS: readonly IdeaView[] = [
  "suggested",
  "considering",
  "planned",
  "built",
  "hidden",
  "merged",
];
const ID_RE = /^[a-z0-9]{15}$/;

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

function toView(r: StaffIdeaRow): IdeaRowView {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    votes: r.votes,
    created: r.created,
    hidden: r.hiddenAt !== null,
    heldForReview: r.holdReason === IDEA_HOLD_REVIEW,
    merged: r.mergedInto !== null,
    business: r.sourceOrgName,
    ticket: r.sourceTicket,
  };
}

function inView(r: IdeaRowView, view: IdeaView): boolean {
  if (view === "merged") return r.merged;
  if (r.merged) return false;
  if (view === "hidden") return r.hidden;
  return !r.hidden && r.status === view;
}

export default async function Panel({ session, params }: StaffPanelProps) {
  const raw = one(params.view);
  const view: IdeaView = (VIEWS as readonly string[]).includes(raw)
    ? (raw as IdeaView)
    : "suggested";
  let all: IdeaRowView[];
  try {
    all = (
      await staffListIdeas(session.ctx, {
        includeHidden: true,
        includeMerged: true,
      })
    ).map(toView);
  } catch (err) {
    console.error("[staff] ideas read failed", errName(err));
    return <SitesLoadError href="/staff/tickets?tab=ideas" />;
  }
  const rows = all
    .filter((r) => inView(r, view))
    .sort((a, b) => b.votes - a.votes || a.title.localeCompare(b.title));
  const openId = one(params.open);
  const opened = ID_RE.test(openId)
    ? all.find((r) => r.id === openId)
    : undefined;
  const now = new Date().toISOString();
  return (
    <>
      <IdeasList rows={rows} view={view} now={now} />
      {opened ? (
        <IdeaDrawer
          key={opened.id}
          idea={opened}
          view={view}
          mergeTargets={all
            .filter((r) => !r.merged && r.id !== opened.id)
            .map((r) => ({ id: r.id, title: r.title, votes: r.votes }))}
        />
      ) : null}
    </>
  );
}

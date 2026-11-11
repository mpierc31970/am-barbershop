// Panel tickets/canned: filled by 13-41
// Panel tickets/canned (13-41 choice 5; STAFF-09, D96; 13-UI-SPEC "Canned replies tab" lines
// 513-523). `?view=active|archived` (default active) over staffListCanned (includeArchived,
// split here); `?edit=<id>` opens that reply's drawer, `?new=1` the new-reply drawer (the
// picker's Add one link). The tab is gated on `canned_replies` (both roles). A failed read logs
// the class name only.
import { staffListCanned, type StaffCannedReply } from "@cds/db";
import type { StaffPanelProps } from "../../StaffAreaPage";
import { SitesLoadError } from "../../sites/SitesLoadError";
import {
  CannedList,
  type CannedRowView,
  type CannedView,
} from "../CannedIsland";

const ID_RE = /^[a-z0-9]{15}$/;

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

function toRow(r: StaffCannedReply): CannedRowView {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    archived: r.archivedAt !== null,
    updated: r.updated,
  };
}

export default async function Panel({ session, params }: StaffPanelProps) {
  const view: CannedView =
    one(params.view) === "archived" ? "archived" : "active";
  const href =
    view === "archived"
      ? "/staff/tickets?tab=canned&view=archived"
      : "/staff/tickets?tab=canned";
  let all: StaffCannedReply[];
  try {
    all = await staffListCanned(session.ctx, { includeArchived: true });
  } catch (err) {
    console.error("[staff] canned read failed", errName(err));
    return <SitesLoadError href={href} />;
  }
  const rows = all
    .filter((r) => (view === "archived") === (r.archivedAt !== null))
    .map(toRow);
  const edit = one(params.edit);
  const agentName = session.name.trim().split(/\s+/)[0] ?? "";
  return (
    <CannedList
      key={view}
      rows={rows}
      view={view}
      agentName={agentName}
      openId={ID_RE.test(edit) ? edit : null}
      startNew={one(params.new) === "1"}
    />
  );
}

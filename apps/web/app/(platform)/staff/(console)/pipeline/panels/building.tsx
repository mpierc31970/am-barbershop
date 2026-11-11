// Panel pipeline/building: filled by 13-34
// Panel pipeline/building (13-34 choice 3; STAFF-01, D29; 13-UI-SPEC "Building" lines 647-653).
// `staffBuildingQueue` (ready_for_build + being_built, longest in stage first): assembly state,
// build note (inline editor, saveBuildNoteAction; agents too), Re-run assembly (CaseDialog;
// agents too) with the re-run lines in a drawer, Move to polish (stage -> being_built,
// super_admin). A failed read logs the class name only.
import {
  BUILD_NOTE_MAX,
  staffBuildingQueue,
  type StaffBuildingRow,
} from "@cds/db";
import { staffCan } from "../../../../../../lib/staff-session";
import type { StaffPanelProps } from "../../StaffAreaPage";
import { SitesLoadError } from "../../sites/SitesLoadError";
import { BuildingTable, type BuildingView } from "../PipelineActions";

function toView(r: StaffBuildingRow): BuildingView {
  return {
    orgId: r.orgId,
    name: r.name,
    stage: r.stage,
    assemblyState: r.assembly.state,
    lastRun: r.assembly.lastRun,
    unfilled: r.assembly.unfilled,
    errorCode: r.assembly.errorCode,
    buildNote: r.buildNote,
    paidAt: r.paidAt,
    inStageSince: r.inStageSince,
  };
}

export default async function Panel({ session }: StaffPanelProps) {
  let rows: StaffBuildingRow[];
  try {
    rows = await staffBuildingQueue(session.ctx);
  } catch (err) {
    console.error(
      "[staff] building queue read failed",
      err instanceof Error ? err.name : typeof err,
    );
    return <SitesLoadError href="/staff/pipeline?tab=building" />;
  }
  return (
    <BuildingTable
      rows={rows.map(toView)}
      now={new Date().toISOString()}
      canStage={staffCan(session.role, "org_stage")}
      canAssemble={staffCan(session.role, "site_assemble")}
      canNote={staffCan(session.role, "build_note")}
      noteMax={BUILD_NOTE_MAX}
    />
  );
}

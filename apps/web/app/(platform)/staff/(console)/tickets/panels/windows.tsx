// Panel tickets/windows: filled by 13-36
// Panel tickets/windows (13-36 choices 1-4; STAFF-10, STAFF-11, D99-D102, D-UI-P13-11;
// 13-UI-SPEC "Service windows" lines 561-583). `?view=ended` lists ended and cleared windows,
// else active and scheduled ones (staffListServiceWindows, the CLI's list). `?new=1` shows the
// WindowForm: sites from staffListSites, open incidents (when the role runs incidents), every
// registry add-on, and `allowed` from staffCan(role, "service_window_platform") (D100). The
// header action is secondary "New window". Agents see platform / add-on rows without End now
// (the action refuses them anyway). A failed read logs the class name only.
import { ADDON_REGISTRY } from "@cds/addon-registry";
import { BUSINESS_TIME_ZONE } from "@cds/core/payments";
import {
  isWideWindowScope,
  windowSpanText,
  windowTargetText,
} from "@cds/core/support";
import {
  staffListIncidents,
  staffListServiceWindows,
  staffListSites,
  staffSupportLabels,
  type ServiceWindowView,
  type StaffIncidentRow,
} from "@cds/db";
import { windowStateOf, WINDOWS_COPY } from "@cds/ui/staff";
import { staffCan } from "../../../../../../lib/staff-session";
import type { StaffPanelProps } from "../../StaffAreaPage";
import { SitesLoadError } from "../../sites/SitesLoadError";
import {
  WindowFormIsland,
  WindowsList,
  type WindowRowView,
} from "../WindowsIsland";

const C = WINDOWS_COPY;
const LIST_HREF = "/staff/tickets?tab=windows";

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

function at(iso: string): Date {
  return new Date(iso.replace(" ", "T"));
}

function addons() {
  return ADDON_REGISTRY.list().map((m) => ({ slug: m.slug, name: m.name }));
}

async function openIncidents(
  session: StaffPanelProps["session"],
  includeResolved: boolean,
): Promise<StaffIncidentRow[]> {
  if (!staffCan(session.role, "incident_run")) return [];
  try {
    return await staffListIncidents(session.ctx, { includeResolved });
  } catch (err) {
    console.error("[staff] incidents read failed", errName(err));
    return [];
  }
}

function HeaderAction() {
  return (
    <div className="flex justify-end">
      <a
        href={`${LIST_HREF}&new=1`}
        className="inline-flex min-h-10 items-center rounded border border-hub-border-strong bg-hub-surface px-4 font-hub text-base font-semibold text-hub-ink hover:bg-hub-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
      >
        {C.newWindow}
      </a>
    </div>
  );
}

export default async function Panel({ session, params }: StaffPanelProps) {
  const allowed = {
    platform: staffCan(session.role, "service_window_platform"),
    addon: staffCan(session.role, "service_window_platform"),
  };

  if (one(params.new) === "1") {
    let sites;
    try {
      sites = await staffListSites(session.ctx);
    } catch (err) {
      console.error("[staff] sites read failed", errName(err));
      return <SitesLoadError href={`${LIST_HREF}&new=1`} />;
    }
    const incidents = await openIncidents(session, false);
    return (
      <section className="flex flex-col gap-6">
        <h2 className="font-hub text-xl font-semibold text-hub-ink">
          {C.formTitle}
        </h2>
        <WindowFormIsland
          allowed={allowed}
          sites={sites.map((s) => ({ id: s.orgId, name: s.name || s.orgId }))}
          addons={addons()}
          incidents={incidents.map((i) => ({ code: i.code, title: i.title }))}
          timeZone={BUSINESS_TIME_ZONE}
        />
      </section>
    );
  }

  const view = one(params.view) === "ended" ? "ended" : "current";
  let rows: ServiceWindowView[];
  let labels: { orgs: Record<string, string>; pages: Record<string, string> };
  try {
    const all = await staffListServiceWindows(session.ctx, {
      includeEnded: view === "ended",
    });
    rows = all.filter(
      (r) => (windowStateOf(r) === "ended") === (view === "ended"),
    );
    labels = await staffSupportLabels(session.ctx, {
      orgIds: rows.map((r) => r.orgId).filter(Boolean),
      pageIds: rows.map((r) => r.page).filter(Boolean),
    });
  } catch (err) {
    console.error("[staff] windows read failed", errName(err));
    return <SitesLoadError href={LIST_HREF} />;
  }
  const incidents = new Map(
    (await openIncidents(session, true)).map((i) => [i.id, i.code]),
  );
  const known = { ...labels, addons: addons() };
  const now = new Date();
  const listRows: WindowRowView[] = rows.map((r) => {
    const target = windowTargetText(r, known);
    return {
      code: r.code,
      scopeText: `${C.scopes[r.scope]} · ${target}`,
      target,
      when: windowSpanText(at(r.startsAt), at(r.endsAt), now),
      state: windowStateOf(r),
      message: r.message,
      incident: r.incident ? (incidents.get(r.incident) ?? "") : "",
      by: r.createdBy === session.ctx.actor ? "You" : "CDS staff",
      canEnd: !isWideWindowScope(r.scope) || allowed.platform,
      href: r.orgId ? `/staff/sites/${r.orgId}` : LIST_HREF,
    };
  });
  return (
    <div className="flex flex-col gap-4">
      <HeaderAction />
      <WindowsList rows={listRows} view={view} />
    </div>
  );
}

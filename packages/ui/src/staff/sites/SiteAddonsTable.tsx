"use client";
// SiteAddonsTable (13-33 choice 3; STAFF-02, ADDON-09, D21; 13-UI-SPEC site detail "Add-ons"
// line 784, dialog line 1078; T-13-33-01). Add-on · State (`on-site` / `addon-off`) · Since ·
// Price (catalog, for the site's path) · one action per row. Super_admin: secondary sm
// "Install add-on" / "Uninstall add-on" → CaseDialog (install is a sale; uninstall keeps the
// content, Invariant 9) with a required Reason → the server action through useStaffAction, so
// a stale sign-in asks for an emailed code first and retries the same call. Support agents see
// the button disabled with "Super Admin only" (REFUSED-ROLE is enforced on the server too).
import { fillCopy, P13_COPY, P13_DIALOGS } from "@cds/core/staff";
import { useState } from "react";
import { Badge } from "../../hub/Badge";
import { Button } from "../../hub/Button";
import { useToast } from "../../hub/Toast";
import { CaseDialog, useStaffAction, type StaffActionResult } from "../dialogs";
import { StaffTable, type StaffColumn } from "../table";
import { SITES_COPY as C, formatSiteDate } from "./copy";

export interface SiteAddonRowView {
  slug: string;
  name: string;
  /** on: active on the site · removed: disabled, data kept · off: never added. */
  state: "on" | "removed" | "off";
  since: string | null;
  /** "$15/mo", "Included"; null = not priced yet. */
  price: string | null;
}

export type SiteAddonAction = (
  orgId: string,
  input: { slug: string; reason: string },
) => Promise<StaffActionResult<{ message: string }>>;

export interface SiteAddonsTableProps {
  orgId: string;
  business: string;
  rows: readonly SiteAddonRowView[];
  /** staffCan(role, "addon_install"): super_admin only. */
  canInstall: boolean;
  install: SiteAddonAction;
  uninstall: SiteAddonAction;
}

type Pending = { row: SiteAddonRowView; mode: "install" | "uninstall" };

function stateBadge(state: SiteAddonRowView["state"]) {
  if (state === "on") return <Badge tone="on-site">{C.addons.onSite}</Badge>;
  return (
    <Badge tone="addon-off">
      {state === "removed" ? C.addons.removed : C.addons.notAdded}
    </Badge>
  );
}

export function SiteAddonsTable({
  orgId,
  business,
  rows,
  canInstall,
  install,
  uninstall,
}: SiteAddonsTableProps) {
  const toast = useToast();
  const [pending, setPending] = useState<Pending | null>(null);
  const runInstall = useStaffAction(install, {
    describe: ([, input]) =>
      `${C.addons.install}: ${rows.find((r) => r.slug === input.slug)?.name ?? input.slug}`,
  });
  const runUninstall = useStaffAction(uninstall, {
    describe: ([, input]) =>
      `${C.addons.uninstall}: ${rows.find((r) => r.slug === input.slug)?.name ?? input.slug}`,
  });

  if (rows.length === 0) {
    return (
      <p className="py-6 font-hub text-base text-hub-ink-muted">
        {C.addons.empty}
      </p>
    );
  }

  const columns: StaffColumn<SiteAddonRowView>[] = [
    {
      id: "addon",
      header: C.addons.cols.addon,
      priority: 1,
      stack: true,
      cell: (r) => <span className="font-semibold">{r.name}</span>,
    },
    {
      id: "state",
      header: C.addons.cols.state,
      priority: 1,
      stack: true,
      cell: (r) => stateBadge(r.state),
    },
    {
      id: "since",
      header: C.addons.cols.since,
      priority: 3,
      nowrap: true,
      cell: (r) => (r.state === "off" ? C.none : formatSiteDate(r.since)),
    },
    {
      id: "price",
      header: C.addons.cols.price,
      priority: 2,
      cell: (r) => r.price ?? C.addons.priceSoon,
    },
    {
      id: "action",
      header: C.addons.action,
      priority: 1,
      stack: true,
      cell: (r) => {
        const mode = r.state === "on" ? "uninstall" : "install";
        const label =
          mode === "install" ? C.addons.install : C.addons.uninstall;
        if (!canInstall) {
          return (
            <span className="inline-flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled
                aria-describedby={`addon-super-${r.slug}`}
              >
                {label}
              </Button>
              <span
                id={`addon-super-${r.slug}`}
                className="text-sm text-hub-ink-muted"
              >
                {P13_COPY.SUPER_ONLY}
              </span>
            </span>
          );
        }
        return (
          <Button
            size="sm"
            aria-label={`${label}: ${r.name}`}
            onClick={() => setPending({ row: r, mode })}
          >
            {label}
          </Button>
        );
      },
    },
  ];

  const d =
    pending?.mode === "uninstall"
      ? P13_DIALOGS.addon_uninstall
      : P13_DIALOGS.addon_install;
  const vars = {
    addon: pending?.row.name ?? "",
    business,
    price: pending?.row.price ?? C.addons.priceSoon,
  };

  return (
    <>
      <StaffTable
        caption={C.addons.caption}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.slug}
        rowLabel={(r) => r.name}
        primaryHref={() => "#"}
        shortcutsEnabled={false}
      />
      {pending ? (
        <CaseDialog
          open
          onClose={() => setPending(null)}
          title={fillCopy(d.title, vars)}
          consequence={fillCopy(d.body, vars)}
          caseRows={[
            [C.overview.details, business],
            [C.addons.cols.addon, pending.row.name],
            [C.addons.cols.price, vars.price],
          ]}
          confirmLabel={d.confirm}
          safeLabel={d.safe}
          destructive={pending.mode === "uninstall"}
          reasonField={{ label: C.addons.reason }}
          onConfirm={async (v) => {
            const input = { slug: pending.row.slug, reason: v.reason ?? "" };
            const res =
              pending.mode === "install"
                ? await runInstall(orgId, input)
                : await runUninstall(orgId, input);
            if (res.ok) toast.show({ message: res.data.message });
            return res;
          }}
        />
      ) : null}
    </>
  );
}

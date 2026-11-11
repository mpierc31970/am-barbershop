"use client";
// StaffList (13-46 choice 3; STAFF-06; 13-UI-SPEC "Settings" Staff, line 1087; T-13-46-01). The
// staff table: Name · Email (masked) · Role badge · Last sign-in · a Role select per row. Your own
// row's select is disabled ("You can't change your own role."). Picking another role opens the
// CaseDialog "Make Lee a Support agent? · Takes effect on their next click." and runs the
// action through useStaffAction (step-up when needed). Invite and remove stay on the CLI.
import type { StaffRole } from "@cds/core";
import { fillCopy, P13_DIALOGS } from "@cds/core/staff";
import { useState } from "react";
import { Badge } from "../../hub/Badge";
import { useToast } from "../../hub/Toast";
import { CaseDialog, useStaffAction, type StaffActionResult } from "../dialogs";
import { SETTINGS_COPY } from "./copy";

const C = SETTINGS_COPY.staff;
const D = P13_DIALOGS.staff_role;

export interface StaffListRowView {
  id: string;
  name: string;
  emailMasked: string;
  role: StaffRole;
  /** Already formatted for display ("Oct 16, 9:40 am"), or null when never signed in. */
  lastSignIn: string | null;
}

export type StaffRoleChange = (
  userId: string,
  role: StaffRole,
) => Promise<StaffActionResult<{ message: string }>>;

export interface StaffListProps {
  rows: readonly StaffListRowView[];
  /** The signed-in staff member (their own select is disabled). */
  currentUserId: string;
  changeRole: StaffRoleChange;
}

const ROLE_OPTIONS = (Object.keys(C.roles) as StaffRole[]).map((r) => ({
  value: r,
  label: C.roles[r],
}));

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

const TH =
  "px-4 py-2 text-left align-middle text-sm font-semibold text-hub-ink";
const TD = "px-4 py-2 text-left align-middle text-sm text-hub-ink";
const SELECT =
  "h-10 w-full rounded border border-hub-border-strong bg-hub-surface px-3 font-hub text-sm text-hub-ink " +
  "hover:border-hub-ink-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent " +
  "disabled:cursor-not-allowed disabled:bg-hub-surface-2 disabled:text-hub-ink-muted";

export function StaffList({ rows, currentUserId, changeRole }: StaffListProps) {
  const toast = useToast();
  const [roles, setRoles] = useState<Record<string, StaffRole>>({});
  const [pending, setPending] = useState<{
    row: StaffListRowView;
    to: StaffRole;
  } | null>(null);
  const run = useStaffAction(changeRole, {
    describe: ([id, role]) => {
      const r = rows.find((x) => x.id === id);
      return fillCopy(D.title, {
        name: r ? firstName(r.name) : "",
        role: C.roles[role],
      });
    },
  });
  const roleOf = (r: StaffListRowView): StaffRole => roles[r.id] ?? r.role;

  return (
    <section className="flex flex-col gap-4">
      {rows.length === 0 ? (
        <p className="py-6 text-base text-hub-ink-muted">{C.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded border border-hub-border">
          <table className="w-full border-collapse">
            <caption className="sr-only">{C.caption}</caption>
            <thead className="bg-hub-surface-2">
              <tr>
                <th scope="col" className={TH}>
                  {C.cols.name}
                </th>
                <th scope="col" className={`${TH} max-md:hidden`}>
                  {C.cols.email}
                </th>
                <th scope="col" className={TH}>
                  {C.cols.role}
                </th>
                <th scope="col" className={`${TH} max-lg:hidden`}>
                  {C.cols.lastSignIn}
                </th>
                <th scope="col" className={TH}>
                  {C.cols.change}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const own = r.id === currentUserId;
                const role = roleOf(r);
                return (
                  <tr
                    key={r.id}
                    data-staff-row={r.id}
                    className="border-t border-hub-border"
                  >
                    <th scope="row" className={`${TD} font-semibold`}>
                      {r.name || r.emailMasked}
                    </th>
                    <td className={`${TD} max-md:hidden`}>{r.emailMasked}</td>
                    <td className={TD}>
                      <Badge tone="role">{C.roles[role]}</Badge>
                    </td>
                    <td className={`${TD} tabular-nums max-lg:hidden`}>
                      {r.lastSignIn ?? C.never}
                    </td>
                    <td className={`${TD} min-w-44`}>
                      <div className="flex flex-col gap-1">
                        <select
                          id={`staff-role-${r.id}`}
                          aria-label={C.roleFor(r.name || r.emailMasked)}
                          aria-describedby={
                            own ? `staff-role-${r.id}-own` : undefined
                          }
                          className={SELECT}
                          value={role}
                          disabled={own}
                          onChange={(e) => {
                            const to = e.currentTarget.value as StaffRole;
                            if (to !== role) setPending({ row: r, to });
                          }}
                        >
                          {ROLE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        {own ? (
                          <span
                            id={`staff-role-${r.id}-own`}
                            className="text-sm text-hub-ink-muted"
                          >
                            {C.ownRole}
                          </span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-sm text-hub-ink-muted">{C.cliNote}</p>
      {pending ? (
        <CaseDialog
          open
          onClose={() => setPending(null)}
          title={fillCopy(D.title, {
            name: firstName(pending.row.name || pending.row.emailMasked),
            role: C.roles[pending.to],
          })}
          consequence={D.body}
          caseRows={[
            [C.caseName, pending.row.name || pending.row.emailMasked],
            [C.caseFrom, C.roles[roleOf(pending.row)]],
            [C.caseTo, C.roles[pending.to]],
          ]}
          confirmLabel={D.confirm}
          safeLabel={D.safe}
          onConfirm={async () => {
            const { row, to } = pending;
            const res = await run(row.id, to);
            if (res.ok) {
              setRoles((m) => ({ ...m, [row.id]: to }));
              toast.show({ message: res.data.message });
            }
            return res;
          }}
        />
      ) : null}
    </section>
  );
}

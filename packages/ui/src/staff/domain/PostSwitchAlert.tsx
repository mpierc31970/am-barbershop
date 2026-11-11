"use client";
// PostSwitchAlert (14-38 choice 2; DOM-08, D169; 14-UI-SPEC "PostSwitchAlert"). Shown at the top
// of Site › Domain only while the post-switch check is open: an error InlineAlert "Post-switch
// check failed · 1 email-critical record differs at 1.1.1.1 and 8.8.8.8 · owner told to switch
// back 10:42", a compact table of the differing records (Type · Name · Copy · Public answer)
// and a secondary **Re-run post-switch check** (both roles) that runs the passed server action
// through useStaffAction and toasts its message. Record values are text nodes (T-14-38-01).
import { P14_COPY } from "@cds/core/dns";
import { RotateCw } from "lucide-react";
import { useState } from "react";
import { Button } from "../../hub/Button";
import { InlineAlert } from "../../hub/feedback";
import { useToast } from "../../hub/Toast";
import { useStaffAction } from "../dialogs";
import {
  DOMAIN_TABLE as T,
  STAFF_DOMAIN_COPY,
  formatDomainWhen,
  type StaffDomainOrgAction,
  type StaffPostSwitchRecordData,
} from "./copy";

const C = STAFF_DOMAIN_COPY.postSwitch;

export interface PostSwitchAlertProps {
  orgId: string;
  open: boolean;
  records: readonly StaffPostSwitchRecordData[];
  /** When the owner was told to switch back (ISO); shown as "10 Oct 10:42". */
  ownerToldAt?: string | null;
  timeZone?: string;
  /** Re-run post-switch check; omitted = read-only. */
  rerun?: StaffDomainOrgAction;
}

export function PostSwitchAlert({
  orgId,
  open,
  records,
  ownerToldAt,
  timeZone,
  rerun,
}: PostSwitchAlertProps) {
  if (!open) return null;
  const when = ownerToldAt ? formatDomainWhen(ownerToldAt, timeZone) : null;
  return (
    <div data-post-switch="" className="flex flex-col gap-3">
      <InlineAlert
        tone="error"
        action={rerun ? <RerunButton orgId={orgId} rerun={rerun} /> : undefined}
      >
        <p className="font-semibold text-hub-danger">
          {C.title(records.length, when)}
        </p>
        {records.length > 0 ? (
          <div className="mt-2 overflow-x-auto">
            <table className={T.table}>
              <caption className="sr-only">{C.caption}</caption>
              <thead>
                <tr className={T.headRow}>
                  <th scope="col" className={T.th}>
                    {C.type}
                  </th>
                  <th scope="col" className={T.th}>
                    {C.name}
                  </th>
                  <th scope="col" className={T.th}>
                    {C.copy}
                  </th>
                  <th scope="col" className={T.th}>
                    {C.publicAnswer}
                  </th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={`${r.type}:${r.name}:${r.copy}`} className={T.row}>
                    <td className={T.td}>{r.type}</td>
                    <td className={`${T.td} ${T.value}`}>{r.name}</td>
                    <td className={`${T.td} ${T.value}`}>{r.copy}</td>
                    <td className={`${T.td} ${T.value}`}>
                      {r.publicAnswer.length > 0
                        ? r.publicAnswer.join(", ")
                        : C.noAnswer}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </InlineAlert>
    </div>
  );
}

function RerunButton({
  orgId,
  rerun,
}: {
  orgId: string;
  rerun: StaffDomainOrgAction;
}) {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const run = useStaffAction(rerun, {
    describe: () => P14_COPY.BTN_RERUN_POST_SWITCH,
  });
  return (
    <Button
      variant="secondary"
      size="sm"
      icon={<RotateCw aria-hidden size={16} strokeWidth={2} />}
      loading={pending}
      loadingLabel={P14_COPY.BTN_CHECKING}
      onClick={async () => {
        if (pending) return;
        setPending(true);
        try {
          const res = await run(orgId);
          if (res.ok) toast.show({ message: res.data.message });
          else if (
            res.code !== "step_up_needed" &&
            res.code !== "session_ended"
          ) {
            toast.show({ message: res.message });
          }
        } finally {
          setPending(false);
        }
      }}
    >
      {P14_COPY.BTN_RERUN_POST_SWITCH}
    </Button>
  );
}

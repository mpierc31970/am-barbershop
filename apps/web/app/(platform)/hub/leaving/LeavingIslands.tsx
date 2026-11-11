"use client";
// /hub/leaving client islands (14-42 choices 1, 3 and 4; LIFE-01, D282). They wire the
// @cds/ui/hub/leaving components to the server actions in actions/leaving.ts, show the toasts
// ("Your 30-day notice has started. Next: move your DNS.", "Your notice is cancelled.") and
// refresh the server view after a change (the banner and the locked steps come from it).
import { useToast } from "@cds/ui/hub";
import {
  HandbackFlow,
  LEAVING_UI_COPY,
  LeaveStartPanel,
  LeavingChecklist,
  type HandbackZoneUi,
  type LeavingChecklistProps,
} from "@cds/ui/hub/leaving";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  checkNewDnsAction,
  chooseDestinationAction,
  completeLeavingStepAction,
  confirmSwitchedAction,
  downloadLeavingDataAction,
  downloadZoneFileAction,
  requestLeaveCodeAction,
  stayWithCdsAction,
  startLeavingAction,
} from "../../../actions/leaving";
import { GuardedLink } from "../GuardedLink";

export const BILLING_HREF = "/hub/settings?tab=billing";

export function StartIsland({
  endsOn,
  endsOnShort,
  billingLines,
  impersonating,
  header,
}: {
  endsOn: string;
  endsOnShort: string;
  billingLines: readonly string[];
  impersonating: boolean;
  header?: ReactNode;
}) {
  const toast = useToast();
  const router = useRouter();
  return (
    <LeaveStartPanel
      endsOn={endsOn}
      endsOnShort={endsOnShort}
      billingLines={billingLines}
      impersonating={impersonating}
      keepHref={BILLING_HREF}
      LinkComponent={GuardedLink}
      header={header}
      requestCode={() => requestLeaveCodeAction()}
      start={(input) => startLeavingAction(input)}
      onStarted={() => {
        toast.show({ message: LEAVING_UI_COPY.startedToast });
        router.refresh();
      }}
    />
  );
}

export type ChecklistIslandProps = Omit<
  LeavingChecklistProps,
  "dns" | "onDownloadData" | "onStepDone" | "onStay" | "onChanged" | "onStayed"
> & { zones: readonly HandbackZoneUi[] };

export function ChecklistIsland({
  zones,
  readOnly = false,
  ...rest
}: ChecklistIslandProps) {
  const toast = useToast();
  const router = useRouter();
  const actions = {
    downloadZoneFile: (d: string) => downloadZoneFileAction(d),
    choose: (d: string, input: Parameters<typeof chooseDestinationAction>[1]) =>
      chooseDestinationAction(d, input),
    check: (d: string) => checkNewDnsAction(d),
    confirm: (d: string) => confirmSwitchedAction(d),
  };
  const dns =
    zones.length > 0 ? (
      <div className="flex flex-col gap-8">
        {zones.map((z) => (
          <section key={`${z.domain}:${z.status}`} aria-label={z.domain}>
            {zones.length > 1 ? (
              <p className="mb-4 font-mono text-sm font-semibold">{z.domain}</p>
            ) : null}
            <HandbackFlow
              zone={z}
              readOnly={readOnly}
              actions={readOnly ? undefined : actions}
              onChanged={() => router.refresh()}
            />
          </section>
        ))}
      </div>
    ) : null;
  return (
    <LeavingChecklist
      {...rest}
      readOnly={readOnly}
      dns={dns}
      onDownloadData={() => downloadLeavingDataAction()}
      onStepDone={(step) => completeLeavingStepAction(step)}
      onStay={() => stayWithCdsAction()}
      onChanged={(message) => {
        if (message) toast.show({ message });
        router.refresh();
      }}
      onStayed={() => {
        toast.show({ message: LEAVING_UI_COPY.stayToast });
        router.push(BILLING_HREF);
      }}
    />
  );
}

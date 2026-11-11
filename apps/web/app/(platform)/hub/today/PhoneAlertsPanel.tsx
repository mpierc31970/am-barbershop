"use client";
// Phone alerts card wiring (11-22; DASH-34). Client glue only: binds the card's save to
// savePushSubscriptionAction and Not now to dismissPhoneAlertsAction. The server decides
// whether the card renders (today/page.tsx PhoneAlertsSection).
import { rememberThisDevice } from "@cds/ui/hub/alerts";
import { PhoneAlertsCard } from "@cds/ui/hub/today";
import {
  dismissPhoneAlertsAction,
  savePushSubscriptionAction,
} from "../../../actions/push";

export function PhoneAlertsPanel({ publicKey }: { publicKey: string }) {
  return (
    <PhoneAlertsCard
      publicKey={publicKey}
      onSave={async (sub) => {
        const res = await savePushSubscriptionAction(sub);
        // 11-24: Profile marks this browser's device "This device".
        if (res.ok) rememberThisDevice(res.data.id);
        return { ok: res.ok };
      }}
      onDismiss={() => {
        void dismissPhoneAlertsAction();
      }}
    />
  );
}

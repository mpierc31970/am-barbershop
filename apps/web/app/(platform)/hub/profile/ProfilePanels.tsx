"use client";
// Your profile and alerts client glue (11-24; DASH-36, DASH-34). Binds the @cds/ui parts to
// the profile actions; the server page decides what each part shows (types already filtered
// by access, prefs, devices, time zone, sensitive mode, impersonation).
import type { AlertTypeSpec } from "@cds/core/alerts";
import { Button, useToast } from "@cds/ui/hub";
import {
  AlertPrefsTable,
  DevicesList,
  PROFILE_COPY,
  QuietHoursForm,
  rememberThisDevice,
  type AlertPrefsMap,
  type DeviceRow,
  type QuietHoursValue,
} from "@cds/ui/hub/alerts";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  removeDeviceAction,
  resetAlertChannelsAction,
  resetToursAction,
  restoreAlertChannelsAction,
  setAlertChannelAction,
  setQuietHoursAction,
} from "../../../actions/profile";
import { savePushSubscriptionAction } from "../../../actions/push";

export interface ProfilePanelsProps {
  types: readonly AlertTypeSpec[];
  alertChannels: AlertPrefsMap;
  quietHours: QuietHoursValue;
  zoneLabel: string;
  timeZone: string;
  devices: readonly DeviceRow[];
  publicKey: string | null;
  sensitiveBusiness: string | null;
  impersonating: boolean;
}

function ToursSection({ disabled }: { disabled: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <section
      aria-labelledby="profile-tours"
      className="flex flex-col gap-4 font-hub text-hub-ink"
    >
      <h2 id="profile-tours" className="text-xl leading-tight font-semibold">
        {PROFILE_COPY.tours}
      </h2>
      <p className="text-base">{PROFILE_COPY.toursBody}</p>
      <div>
        <Button
          variant="secondary"
          disabled={disabled || busy}
          onClick={async () => {
            setBusy(true);
            const res = await resetToursAction();
            setBusy(false);
            toast.show({
              message: res.ok ? PROFILE_COPY.toursDone : res.message,
            });
          }}
        >
          {PROFILE_COPY.toursAgain}
        </Button>
      </div>
    </section>
  );
}

export function ProfilePanels(p: ProfilePanelsProps) {
  const router = useRouter();
  return (
    <>
      <AlertPrefsTable
        types={p.types}
        initial={p.alertChannels}
        sensitiveBusiness={p.sensitiveBusiness}
        disabled={p.impersonating}
        onToggle={(type, channel, on) =>
          setAlertChannelAction(type, channel, on)
        }
        onReset={() => resetAlertChannelsAction()}
        onRestore={(previous) => restoreAlertChannelsAction(previous)}
      />
      <QuietHoursForm
        initial={p.quietHours}
        zoneLabel={p.zoneLabel}
        disabled={p.impersonating}
        onSave={(v) => setQuietHoursAction(v)}
      />
      <DevicesList
        devices={p.devices}
        timeZone={p.timeZone}
        publicKey={p.publicKey}
        disabled={p.impersonating}
        onRemove={(id) => removeDeviceAction(id)}
        onSave={async (sub) => {
          const res = await savePushSubscriptionAction(sub);
          if (res.ok) rememberThisDevice(res.data.id);
          return res.ok ? { ok: true, id: res.data.id } : { ok: false };
        }}
        onTurnedOn={() => router.refresh()}
      />
      <ToursSection disabled={p.impersonating} />
    </>
  );
}

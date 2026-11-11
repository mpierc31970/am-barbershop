"use client";
// DevicesList (11-24; DASH-34, DASH-36; 11-UI-SPEC "Profile" § 4 Phones and computers, lines
// 392-396; DEVICES-EMPTY). The person's devices with phone alerts on: "iPhone · turned on
// 9 Oct" (user-agent family + date in the business time zone) and a ghost sm Turn off
// (accessible name "Turn off alerts on iPhone, turned on 9 Oct"; immediate, Toast "Alerts
// turned off for that device."). This device comes first with Label "This device": the
// browser remembers the id its subscription was saved under (localStorage; the server never
// sends endpoints back). Empty: DEVICES-EMPTY. When this browser can take push and is not on
// the list: secondary "Turn on alerts on this device", the same flow as the Today card
// (permission prompt only on the click).
import { useState, useSyncExternalStore } from "react";
import type { HubActionResult } from "../addon-types";
import { Button } from "../Button";
import { InlineAlert } from "../feedback";
import { useToast } from "../Toast";
import {
  canTurnOn,
  readPushEnv,
  subscribeThisDevice,
  type DeviceFamily,
  type PushEnv,
  type SaveSubscription,
  type SubscribeOutcome,
} from "../today/push-client";
import { PROFILE_COPY as C, deviceLine, turnOffLabel } from "./copy";

/** One device as the hub receives it (the shape of @cds/db PushDevice). */
export type DeviceRow = {
  id: string;
  uaFamily: string;
  createdAt: string;
  lastOkAt: string | null;
  failCount: number;
};

/** localStorage key holding the id this browser's subscription was saved under. */
export const THIS_DEVICE_KEY = "cds-hub-push-device";

/** Remember this browser's device id (after a successful save). Never throws. */
export function rememberThisDevice(id: string): void {
  try {
    window.localStorage.setItem(THIS_DEVICE_KEY, id);
  } catch {
    // Private mode or storage off: the list simply has no "This device" label.
  }
}

function readThisDevice(): string {
  try {
    return window.localStorage.getItem(THIS_DEVICE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Save that also reports the id (savePushSubscriptionAction's data). */
export type SaveDevice = (
  sub: Parameters<SaveSubscription>[0],
) => Promise<{ ok: boolean; id?: string }>;

export interface DevicesListProps {
  devices: readonly DeviceRow[];
  timeZone: string;
  /** VAPID public key, or null when Web Push is not configured (no Turn on button). */
  publicKey: string | null;
  disabled?: boolean;
  onRemove(id: string): Promise<HubActionResult<unknown>>;
  onSave: SaveDevice;
  /** After this device was turned on (the page reloads its list). */
  onTurnedOn?: () => void;
  /** Tests: browser snapshot, subscribe step and this-device id. */
  readEnv?: () => PushEnv;
  subscribe?: (
    publicKey: string,
    save: SaveSubscription,
    family: DeviceFamily,
  ) => Promise<SubscribeOutcome>;
  readDeviceId?: () => string;
}

const noopSubscribe = () => () => {};
const SERVER = "server";

export function DevicesList({
  devices,
  timeZone,
  publicKey,
  disabled = false,
  onRemove,
  onSave,
  onTurnedOn,
  readEnv = readPushEnv,
  subscribe = subscribeThisDevice,
  readDeviceId = readThisDevice,
}: DevicesListProps) {
  const toast = useToast();
  const [rows, setRows] = useState<readonly DeviceRow[]>(devices);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<"denied" | "error" | null>(null);
  // Browser facts after hydration; the server snapshot offers no button.
  const offerKey = useSyncExternalStore(
    noopSubscribe,
    () => {
      const env = readEnv();
      return `${canTurnOn(env) ? "1" : "0"}|${env.family}`;
    },
    () => SERVER,
  );
  const thisId = useSyncExternalStore(noopSubscribe, readDeviceId, () => "");
  const [savedHere, setSavedHere] = useState<string | null>(null);
  const hereId = savedHere ?? thisId;

  const sorted = [...rows].sort(
    (a, b) => Number(b.id === hereId) - Number(a.id === hereId),
  );
  const hereListed = hereId !== "" && rows.some((r) => r.id === hereId);
  const [canOffer, family] =
    offerKey === SERVER ? [false, "desktop"] : offerKey.split("|");
  const offer =
    !disabled && publicKey !== null && canOffer === "1" && !hereListed;

  async function remove(row: DeviceRow) {
    if (disabled || busy) return;
    setBusy(row.id);
    const res = await onRemove(row.id);
    setBusy(null);
    if (!res.ok) {
      toast.show({ message: res.message });
      return;
    }
    setRows((list) => list.filter((r) => r.id !== row.id));
    toast.show({ message: C.turnedOff });
  }

  async function turnOn() {
    if (!publicKey || busy) return;
    setBusy("here");
    setProblem(null);
    let savedId = "";
    const outcome = await subscribe(
      publicKey,
      async (sub) => {
        const res = await onSave(sub);
        if (res.ok && res.id) savedId = res.id;
        return { ok: res.ok };
      },
      family as DeviceFamily,
    );
    setBusy(null);
    if (outcome !== "on") {
      setProblem(outcome);
      return;
    }
    if (savedId) {
      rememberThisDevice(savedId);
      setSavedHere(savedId);
      setRows((list) =>
        list.some((r) => r.id === savedId)
          ? list
          : [
              ...list,
              {
                id: savedId,
                uaFamily: String(family),
                createdAt: new Date().toISOString(),
                lastOkAt: null,
                failCount: 0,
              },
            ],
      );
    }
    toast.show({ message: C.turnedOn });
    onTurnedOn?.();
  }

  return (
    <section
      aria-labelledby="profile-devices"
      className="flex flex-col gap-4 font-hub text-hub-ink"
      data-profile-devices=""
    >
      <h2 id="profile-devices" className="text-xl leading-tight font-semibold">
        {C.devices}
      </h2>
      {sorted.length === 0 ? (
        <p className="text-base text-hub-ink-muted">{C.devicesEmpty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-hub-border border-y border-hub-border">
          {sorted.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-2 py-3"
              data-device={d.id}
            >
              <span className="flex flex-col">
                <span className="text-base">{deviceLine(d, timeZone)}</span>
                {d.id === hereId ? (
                  <span className="text-sm text-hub-ink-muted">
                    {C.thisDevice}
                  </span>
                ) : null}
              </span>
              <Button
                variant="ghost"
                size="sm"
                aria-label={turnOffLabel(d, timeZone)}
                disabled={disabled || busy !== null}
                onClick={() => void remove(d)}
              >
                {C.turnOff}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {offer ? (
        <div>
          <Button
            variant="secondary"
            disabled={busy !== null}
            aria-busy={busy === "here" ? true : undefined}
            onClick={() => void turnOn()}
          >
            {C.turnOnHere}
          </Button>
        </div>
      ) : null}
      {problem === "denied" ? (
        <InlineAlert tone="warning">{C.pushDenied}</InlineAlert>
      ) : problem === "error" ? (
        <InlineAlert tone="error">{C.pushError}</InlineAlert>
      ) : null}
    </section>
  );
}

"use client";
// PhoneAlertsCard (11-22; DASH-34; 11-UI-SPEC "Today" § 7 Phone alerts card, lines 529-544;
// copy PUSH-CARD-BODY, PUSH-DENIED, PUSH-UNSUPPORTED, ERR-PUSH). One time, in the Today side
// rail between This week and From CDS. Panel hub-surface-2, 24px padding.
// - Smartphone 20 + Heading "Get alerts on your phone", PUSH-CARD-BODY.
// - SegmentedControl iPhone · Android (preselected from the user agent; else iPhone) and the
//   steps as an <ol>.
// - Secondary "Turn on alerts" only where the browser supports push and, on iPhone, the hub
//   runs from the home screen; otherwise PUSH-UNSUPPORTED (Label, ink-muted). Ghost "Not now"
//   dismisses (saved per person by the caller).
// - Turn on alerts → the permission prompt (only on this click, never on load) → subscribe →
//   save → Toast "Alerts are on for this device." and the card leaves. Denied → InlineAlert
//   warning PUSH-DENIED; any other failure → InlineAlert error ERR-PUSH.
// The server decides whether to render it at all (not dismissed, no device yet, not staff).
import { Smartphone } from "lucide-react";
import { useId, useState, useSyncExternalStore } from "react";
import { Button } from "../Button";
import { InlineAlert } from "../feedback";
import { SegmentedControl } from "../SegmentedControl";
import { useToast } from "../Toast";
import {
  canTurnOn,
  readPushEnv,
  subscribeThisDevice,
  type DeviceFamily,
  type PushEnv,
  type SaveSubscription,
  type SubscribeOutcome,
} from "./push-client";

export const PHONE_ALERTS_COPY = {
  heading: "Get alerts on your phone",
  body: "Hear about new messages and urgent problems straight away, even when the hub is closed. You choose which alerts reach your phone.",
  deviceLabel: "Your phone",
  iphone: "iPhone",
  android: "Android",
  iphoneSteps: [
    "Open this page in Safari on your iPhone.",
    "Tap Share, then Add to Home Screen.",
    "Open the hub from your home screen and tap Turn on alerts.",
  ],
  androidSteps: [
    "Open this page in Chrome on your phone.",
    "Tap Turn on alerts and allow notifications.",
    "Optional: tap the menu, then Add to Home screen.",
  ],
  turnOn: "Turn on alerts",
  turningOn: "Turning on alerts",
  notNow: "Not now",
  on: "Alerts are on for this device.",
  denied:
    "Alerts are blocked for this site in your browser settings. Allow notifications there, then tap Turn on alerts again.",
  unsupported:
    "This browser can't show phone alerts. On iPhone, add the hub to your home screen first.",
  error: "We couldn't turn on alerts just now. Try again in a minute.",
} as const;

type Steps = "iphone" | "android";

export interface PhoneAlertsCardProps {
  /** VAPID public key from the server (prop, never NEXT_PUBLIC_). */
  publicKey: string;
  onSave: SaveSubscription;
  /** "Not now": the caller saves the seen flag. */
  onDismiss: () => unknown;
  /** Tests: the browser snapshot and the subscribe step. */
  readEnv?: () => PushEnv;
  subscribe?: (
    publicKey: string,
    save: SaveSubscription,
    family: DeviceFamily,
  ) => Promise<SubscribeOutcome>;
}

const noopSubscribe = () => () => {};
const SERVER_ENV = "server";

function envKey(env: PushEnv): string {
  return [env.family, env.standalone, env.supported, env.permission].join("|");
}

function parseEnv(key: string): PushEnv | null {
  if (key === SERVER_ENV) return null;
  const [family, standalone, supported, permission] = key.split("|");
  return {
    family: family as DeviceFamily,
    standalone: standalone === "true",
    supported: supported === "true",
    permission: permission as PushEnv["permission"],
  };
}

export function PhoneAlertsCard({
  publicKey,
  onSave,
  onDismiss,
  readEnv = readPushEnv,
  subscribe = subscribeThisDevice,
}: PhoneAlertsCardProps) {
  const headingId = useId();
  const toast = useToast();
  // The server has no browser: its snapshot shows the steps without a button, and React
  // re-renders with this browser's facts right after hydration (no markup mismatch).
  const env = parseEnv(
    useSyncExternalStore(
      noopSubscribe,
      () => envKey(readEnv()),
      () => SERVER_ENV,
    ),
  );
  const [picked, setPicked] = useState<Steps | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<"denied" | "error" | null>(null);
  const [gone, setGone] = useState(false);
  if (gone) return null;

  const steps: Steps =
    picked ?? (env?.family === "android" ? "android" : "iphone");
  const offer = env ? canTurnOn(env) : false;
  const denied = problem === "denied" || env?.permission === "denied";

  async function turnOn() {
    if (busy || !env) return;
    setBusy(true);
    setProblem(null);
    const outcome = await subscribe(publicKey, onSave, env.family);
    setBusy(false);
    if (outcome === "on") {
      setGone(true);
      toast.show({ message: PHONE_ALERTS_COPY.on });
    } else {
      setProblem(outcome);
    }
  }

  const list =
    steps === "iphone"
      ? PHONE_ALERTS_COPY.iphoneSteps
      : PHONE_ALERTS_COPY.androidSteps;

  return (
    <section
      aria-labelledby={headingId}
      data-phone-alerts=""
      className="flex flex-col gap-4 rounded-lg bg-hub-surface-2 p-6 font-hub text-hub-ink"
    >
      <div className="flex items-center gap-2">
        <Smartphone aria-hidden size={20} strokeWidth={2} />
        <h2 id={headingId} className="text-xl leading-tight font-semibold">
          {PHONE_ALERTS_COPY.heading}
        </h2>
      </div>
      <p className="text-base">{PHONE_ALERTS_COPY.body}</p>
      <SegmentedControl<Steps>
        name="phone-alerts-device"
        label={PHONE_ALERTS_COPY.deviceLabel}
        options={[
          { value: "iphone", label: PHONE_ALERTS_COPY.iphone },
          { value: "android", label: PHONE_ALERTS_COPY.android },
        ]}
        value={steps}
        onChange={setPicked}
      />
      <ol
        className="flex list-decimal flex-col gap-1 pl-5 text-base"
        data-phone-steps={steps}
      >
        {list.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      {denied ? (
        <InlineAlert tone="warning">{PHONE_ALERTS_COPY.denied}</InlineAlert>
      ) : null}
      {problem === "error" ? (
        <InlineAlert tone="error">{PHONE_ALERTS_COPY.error}</InlineAlert>
      ) : null}
      {env && !offer ? (
        <p className="text-sm text-hub-ink-muted" data-phone-unsupported="">
          {PHONE_ALERTS_COPY.unsupported}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {offer ? (
          <Button
            variant="secondary"
            loading={busy}
            loadingLabel={PHONE_ALERTS_COPY.turningOn}
            onClick={() => {
              void turnOn();
            }}
          >
            {PHONE_ALERTS_COPY.turnOn}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setGone(true);
            onDismiss();
          }}
        >
          {PHONE_ALERTS_COPY.notNow}
        </Button>
      </div>
    </section>
  );
}

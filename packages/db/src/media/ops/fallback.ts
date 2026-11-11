// CDN outage state from the probe (07-27; D278, CONT-20; choice 3). The delivery-mode state
// machine is 07-10's (media/cdn/mode): this file only sets and clears `media:cdn_down_since`
// (earliest timestamp kept) and sends the staff alerts.
//
//   ok        -> outage cleared (timestamp + both markers), `recovered` when one was open
//   skipped   -> app stand-in: any leftover timestamp is cleared (a switch back from bunny)
//   no-canary -> no canary row: cleared (nothing published can be affected); a canary whose
//                origin object is unreadable leaves the CDN state unchanged
//   down      -> timestamp written once (= now), start alert once, cap alert once at 72 h
//
// Alerts are sent at most once per outage and retried on failure: START_MARKER / CAP_MARKER
// hold the outage start ISO an alert was sent for, written only after a successful send.
// There is no recovery email type, so recovery is only logged.
import type { SystemContext } from "../../context";
import { readPlatformMeta, writePlatformMeta } from "../../platform-meta";
import {
  FALLBACK_VIDEO_CAP_MS,
  readCdnDownSince,
  writeCdnDownSince,
} from "../cdn/mode";
import {
  sendMediaAlert,
  type AlertStatus,
  type MediaAlertData,
} from "./alerts";
import type { ProbeOutcome } from "./probe";

export const START_MARKER = "media:cdn_start_alerted";
export const CAP_MARKER = "media:cdn_cap_alerted";

export const FALLBACK_START_DETAIL =
  "Bunny CDN failed its hourly check. Images are served from short-lived origin links; videos keep playing until the 72-hour cap.";
export const FALLBACK_CAP_DETAIL =
  "The CDN has been down for 72 hours. Videos now show their cover image only until the CDN is back.";

export type FallbackDeps = {
  read?: () => Promise<Date | null>;
  write?: (ctx: SystemContext, at: Date | null) => Promise<void>;
  readMeta?: (key: string) => Promise<string | null>;
  writeMeta?: (ctx: SystemContext, key: string, value: string) => Promise<void>;
  alert?: (
    ctx: SystemContext,
    data: MediaAlertData,
  ) => Promise<{ status: AlertStatus }>;
};

export type FallbackResult = {
  downSince: Date | null;
  started: boolean;
  capped: boolean;
  recovered: boolean;
  alertsSkipped: number;
  alertFailures: number;
};

export async function applyProbe(
  ctx: SystemContext,
  probe: ProbeOutcome,
  now: Date,
  deps: FallbackDeps = {},
): Promise<FallbackResult> {
  const read = deps.read ?? (() => readCdnDownSince());
  const write =
    deps.write ??
    ((c: SystemContext, at: Date | null) => writeCdnDownSince(c, at));
  const readMeta = deps.readMeta ?? readPlatformMeta;
  const writeMeta = deps.writeMeta ?? writePlatformMeta;
  const alert = deps.alert ?? sendMediaAlert;

  const since = await read();
  const result: FallbackResult = {
    downSince: since,
    started: false,
    capped: false,
    recovered: false,
    alertsSkipped: 0,
    alertFailures: 0,
  };

  const clear = async (): Promise<void> => {
    if (since) await write(ctx, null);
    for (const key of [START_MARKER, CAP_MARKER]) {
      const v = await readMeta(key);
      if (v) await writeMeta(ctx, key, "");
    }
    result.downSince = null;
  };

  const count = (s: AlertStatus): void => {
    if (s === "skipped") result.alertsSkipped += 1;
    else if (s === "failed") result.alertFailures += 1;
  };

  switch (probe.result) {
    case "ok": {
      if (since) {
        const hours = Math.round((now.getTime() - since.getTime()) / 3_600_000);
        await clear();
        result.recovered = true;
        console.info(`[jobs/media] CDN recovered after about ${hours} h`);
      }
      return result;
    }
    case "skipped": {
      if (since) await clear();
      return result;
    }
    case "no-canary": {
      if (!probe.canary && since) await clear();
      return result;
    }
    case "down": {
      let start = since;
      if (!start) {
        start = now;
        await write(ctx, start);
        result.started = true;
      }
      result.downSince = start;
      const iso = start.toISOString();
      if ((await readMeta(START_MARKER)) !== iso) {
        const r = await alert(ctx, {
          event: "cdn-fallback-start",
          at: start,
          orgName: null,
          detail: FALLBACK_START_DETAIL,
          link: null,
        });
        if (r.status === "sent") await writeMeta(ctx, START_MARKER, iso);
        else count(r.status);
      }
      if (now.getTime() - start.getTime() >= FALLBACK_VIDEO_CAP_MS) {
        if ((await readMeta(CAP_MARKER)) !== iso) {
          const r = await alert(ctx, {
            event: "cdn-fallback-cap",
            at: now,
            orgName: null,
            detail: FALLBACK_CAP_DETAIL,
            link: null,
          });
          if (r.status === "sent") {
            await writeMeta(ctx, CAP_MARKER, iso);
            result.capped = true;
          } else count(r.status);
        }
      }
      return result;
    }
  }
}

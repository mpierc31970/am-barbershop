// P11 alerts/push Web Push adapter (11-22; DASH-34, DASH-36). The ONLY file in the repo that
// imports `web-push` (PUSH-01: eslint no-restricted-imports + tests/deps-boundary.test.ts).
//
// Standard Web Push with VAPID. The payload is the PushPayload JSON the service worker
// (/hub/sw.js) shows. 404/410 from the push service = the device unsubscribed ("gone"); every
// other failure is "error". Only the status code is ever logged: the endpoint is a capability
// URL and the keys are secrets (T-11-22-01).
import { createHash } from "node:crypto";
import webpush from "web-push";
import type {
  PushOutcome,
  PushPayload,
  PushSender,
  PushSubscriptionKeys,
} from "./port";

export type VapidConfig = {
  /** `mailto:` or `https:` contact for the push services; never localhost. */
  subject: string;
  publicKey: string;
  privateKey: string;
};

/** One hour: an alert older than that is not worth waking a phone for. */
export const PUSH_TTL_SECONDS = 3600;

/**
 * The Topic header (RFC 8030): at most 32 URL-safe base64 characters. A newer push with the
 * same topic replaces an undelivered older one at the push service.
 */
export function pushTopic(tag: string): string {
  return createHash("sha256").update(tag).digest("base64url").slice(0, 32);
}

/**
 * The browser push services (review 11 WR-B04): Chrome, Edge (Chromium), Samsung and Opera use
 * FCM; Firefox uses Mozilla autopush; legacy Edge uses WNS; Safari uses Apple. The endpoint is
 * untrusted browser input the server POSTs to, so only these hosts are ever accepted or sent
 * to (no pattern block list, no DNS: an attacker domain resolving to an internal address
 * never matches).
 */
const PUSH_SERVICE_HOSTS: readonly RegExp[] = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/,
  /^([a-z0-9-]+\.)*notify\.windows\.com$/,
  /^([a-z0-9-]+\.)*push\.apple\.com$/,
];

/** True when `endpoint` is a plain https URL on a known browser push service. */
export function isPushServiceEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.some((re) => re.test(host));
}

/** A VAPID subject must be `mailto:` or a public `https:` URL (never localhost). */
export function validVapidSubject(subject: string): boolean {
  if (/^mailto:[^\s@]+@[^\s@]+$/.test(subject)) return true;
  let url: URL;
  try {
    url = new URL(subject);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return !(
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "[::1]"
  );
}

/** VAPID config from env, or null when any of the three is missing or the subject is invalid. */
export function vapidFromEnv(
  env: Record<string, string | undefined> = process.env,
): VapidConfig | null {
  const subject = env.VAPID_SUBJECT?.trim() ?? "";
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() ?? "";
  if (!subject || !publicKey || !privateKey) return null;
  if (!validVapidSubject(subject)) return null;
  return { subject, publicKey, privateKey };
}

function statusOf(err: unknown): number | null {
  if (err && typeof err === "object" && "statusCode" in err) {
    const code = (err as { statusCode: unknown }).statusCode;
    return typeof code === "number" ? code : null;
  }
  return null;
}

/** The real sender. VAPID details travel per request, so no module-global state is set. */
export function webPushSender(vapid: VapidConfig): PushSender {
  return {
    async send(
      sub: PushSubscriptionKeys,
      payload: PushPayload,
    ): Promise<PushOutcome> {
      // WR-B04: a row stored before the allowlist (or written around it) is never POSTed
      // to; "gone" deletes it.
      if (!isPushServiceEndpoint(sub.endpoint)) return "gone";
      const body = JSON.stringify({
        title: payload.title,
        org: payload.org,
        body: payload.body,
        href: payload.href,
        tag: payload.tag,
      });
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
          {
            TTL: PUSH_TTL_SECONDS,
            urgency: payload.urgency === "high" ? "high" : "normal",
            // WR-C01 / IN-B04: per org, so one site's push never replaces another's.
            topic: pushTopic(`${payload.org}:${payload.tag}`),
            vapidDetails: {
              subject: vapid.subject,
              publicKey: vapid.publicKey,
              privateKey: vapid.privateKey,
            },
          },
        );
        return "ok";
      } catch (err) {
        const status = statusOf(err);
        if (status === 404 || status === 410) return "gone";
        console.error(`[alerts] web push failed status=${status ?? "none"}`);
        return "error";
      }
    },
  };
}

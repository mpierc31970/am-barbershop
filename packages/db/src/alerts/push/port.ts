// P11 alerts/push port (11-20; DASH-36). The one seam between the alert write path and a
// Web Push transport. Internal to @cds/db: never re-exported from the alerts barrel.
//
// getPushSender() returns the Web Push adapter (11-22) when VAPID_SUBJECT, VAPID_PUBLIC_KEY and
// VAPID_PRIVATE_KEY are all set (and the subject is mailto:/https:), else the fake recorder, so
// nothing leaves the server without keys. The adapter maps 404/410 to "gone"; callers delete
// those subscriptions (subscriptions.ts markGone) and count "error" in fail_count.
import { createFakePushSender, type FakePushSender } from "./fake";
import { vapidFromEnv, webPushSender } from "./web-push";

/** A stored Web Push subscription (push_subscriptions row, server-only fields). */
export type PushSubscriptionKeys = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

/** The notification shown on the device (UI-SPEC Push). `tag` collapses per type. */
export type PushPayload = {
  /** Business name, so a person in two sites knows which. */
  title: string;
  /**
   * The org that raised the alert (review 11 WR-C01): the service worker opens `href` in this
   * site (via /hub/switch) and keys the notification tag and push Topic by it, so one site's
   * alert never opens or replaces another's.
   */
  org: string;
  /** The alert title, or the safe title in sensitive-practice mode. */
  body: string;
  /** Relative hub link opened on tap. */
  href: string;
  tag: string;
  urgency: "high" | "normal";
};

/** "gone" = the endpoint no longer exists (404/410); "error" = anything else. */
export type PushOutcome = "ok" | "gone" | "error";

export type PushSender = {
  send(sub: PushSubscriptionKeys, payload: PushPayload): Promise<PushOutcome>;
};

let override: PushSender | null = null;
let fallback: FakePushSender | null = null;
let real: { key: string; sender: PushSender } | null = null;

/**
 * The configured sender: a test override, else Web Push when VAPID_PRIVATE_KEY (with the
 * subject and public key) is set, else the fake recorder (the stand-in until keys exist).
 */
export function getPushSender(): PushSender {
  if (override) return override;
  const vapid = vapidFromEnv();
  if (vapid) {
    const key = vapid.subject + "|" + vapid.publicKey + "|" + vapid.privateKey;
    if (real?.key !== key) real = { key, sender: webPushSender(vapid) };
    return real.sender;
  }
  fallback ??= createFakePushSender();
  return fallback;
}

/** Tests: swap the sender (null restores the default). */
export function setPushSenderForTests(sender: PushSender | null): void {
  override = sender;
}

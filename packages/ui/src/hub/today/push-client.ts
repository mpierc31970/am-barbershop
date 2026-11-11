// Phone alerts, browser side (11-22; DASH-34; 11-RESEARCH Pattern 5, Pitfall 8). Pure helpers
// plus subscribeThisDevice, which must run inside the click handler: iPhone Safari only grants
// the permission prompt on a user gesture, so Notification.requestPermission() is the FIRST
// call, before any await. The VAPID public key arrives as a prop from the server (never a
// NEXT_PUBLIC_ variable). Nothing here runs on load.

export type DeviceFamily = "iphone" | "android" | "desktop";

export type PushEnv = {
  family: DeviceFamily;
  /** Running as an installed app (home screen / standalone window). */
  standalone: boolean;
  /** serviceWorker + PushManager + Notification all exist. */
  supported: boolean;
  permission: NotificationPermission | "unsupported";
};

export type SaveSubscription = (sub: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  uaFamily: string;
}) => Promise<{ ok: boolean }>;

export type SubscribeOutcome = "on" | "denied" | "error";

export const HUB_SW_URL = "/hub/sw.js";
export const HUB_SW_SCOPE = "/hub/";

/** iPhone / iPad (incl. iPadOS that reports as a Mac with touch), Android, else desktop. */
export function deviceFamily(ua: string, maxTouchPoints = 0): DeviceFamily {
  if (/iPhone|iPad|iPod/i.test(ua)) return "iphone";
  if (/Macintosh/i.test(ua) && maxTouchPoints > 1) return "iphone";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches
  );
}

export function pushSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "serviceWorker" in window.navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** A snapshot of this browser; call only in the browser. */
export function readPushEnv(): PushEnv {
  const nav = window.navigator;
  const supported = pushSupported();
  return {
    family: deviceFamily(nav.userAgent, nav.maxTouchPoints ?? 0),
    standalone: isStandalone(),
    supported,
    permission: supported ? Notification.permission : "unsupported",
  };
}

/**
 * Whether Turn on alerts is offered: the browser supports push and, on iPhone, the hub runs
 * from the home screen (Safari tabs cannot subscribe).
 */
export function canTurnOn(env: PushEnv): boolean {
  if (!env.supported) return false;
  return env.family !== "iphone" || env.standalone;
}

/** Base64url (VAPID public key) → bytes for applicationServerKey. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** True when the subscription's applicationServerKey is exactly `want` (WR-D05). */
export function sameKey(
  have: ArrayBuffer | ArrayBufferView | null | undefined,
  want: Uint8Array,
): boolean {
  if (!have) return false;
  const bytes = ArrayBuffer.isView(have)
    ? new Uint8Array(have.buffer, have.byteOffset, have.byteLength)
    : new Uint8Array(have);
  if (bytes.length !== want.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== want[i]) return false;
  }
  return true;
}

/** How long sign-out waits for the browser to drop its subscription (never blocks). */
export const FORGET_TIMEOUT_MS = 3000;

/**
 * Sign-out (review 11 WR-A02, WR-E01): unsubscribe this browser from the hub's push and
 * return the old endpoint, so the server can drop the signed-out person's row for it. Never
 * throws and never waits more than FORGET_TIMEOUT_MS: sign-out always goes ahead. Null
 * when push is unsupported, nothing was subscribed, or the browser did not answer.
 */
export async function forgetThisBrowser(
  timeoutMs = FORGET_TIMEOUT_MS,
): Promise<string | null> {
  if (!pushSupported()) return null;
  const work = (async () => {
    try {
      const reg = await navigator.serviceWorker.getRegistration(HUB_SW_SCOPE);
      const sub = await reg?.pushManager.getSubscription();
      if (!sub) return null;
      const endpoint = sub.endpoint;
      await sub.unsubscribe().catch(() => false);
      return endpoint || null;
    } catch {
      return null;
    }
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((done) => {
    timer = setTimeout(() => done(null), timeoutMs);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Click handler body: ask permission (first, on the gesture), register the hub worker
 * (scope /hub/, updateViaCache none), subscribe (userVisibleOnly), then save on the server.
 */
export async function subscribeThisDevice(
  publicKey: string,
  save: SaveSubscription,
  family: DeviceFamily = "desktop",
): Promise<SubscribeOutcome> {
  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    return "error";
  }
  if (permission === "denied") return "denied";
  if (permission !== "granted") return "denied";
  try {
    const reg = await navigator.serviceWorker.register(HUB_SW_URL, {
      scope: HUB_SW_SCOPE,
      updateViaCache: "none",
    });
    await navigator.serviceWorker.ready;
    const want = urlBase64ToUint8Array(publicKey);
    let sub = await reg.pushManager.getSubscription();
    // Review 11 WR-D05: a subscription made with an old VAPID key (rotated, or another
    // environment) can never be pushed with the current one. Replace it.
    if (sub && !sameKey(sub.options?.applicationServerKey ?? null, want)) {
      await sub.unsubscribe().catch(() => false);
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: want,
    });
    const json = sub.toJSON();
    const res = await save({
      endpoint: json.endpoint ?? sub.endpoint,
      keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
      uaFamily: family,
    });
    return res.ok ? "on" : "error";
  } catch {
    return "error";
  }
}

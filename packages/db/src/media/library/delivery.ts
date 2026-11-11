// The MediaDelivery selector (07-12; CONTEXT Area 1 Q2: a config-only swap; 07-10 choice 1).
//   CDS_MEDIA_CDN unset or "app" -> the app stand-in (07-09 appDelivery)
//   CDS_MEDIA_CDN "bunny"        -> createBunnyDelivery, protected media delegated to the app
// Any other value throws: a typo must never silently serve media from the wrong place.
// A missing BUNNY_* variable throws (names only) at first use, never here.
import type { MediaDelivery } from "../ports";
import { createBunnyDelivery } from "../cdn/bunny";
import { appDelivery } from "../store/app-delivery";

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

const cache = new Map<string, MediaDelivery>();

export function getMediaDelivery(env: Env = process.env): MediaDelivery {
  const raw = env.CDS_MEDIA_CDN;
  const value = raw === undefined || raw === "" ? "app" : raw;
  if (value !== "app" && value !== "bunny") {
    throw new Error("CDS_MEDIA_CDN must be app or bunny");
  }
  if (value === "app") return appDelivery;
  // Cached per value for the process env; an injected env (tests, checks) gets its own.
  if (env !== process.env) {
    return createBunnyDelivery({ env, privateDelivery: appDelivery });
  }
  let d = cache.get(value);
  if (!d) {
    d = createBunnyDelivery({ env, privateDelivery: appDelivery });
    cache.set(value, d);
  }
  return d;
}

/** Tests only: forget the cached Bunny instance. */
export function resetMediaDeliveryForTests(): void {
  cache.clear();
}

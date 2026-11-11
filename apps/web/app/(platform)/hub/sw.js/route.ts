// /hub/sw.js: the hub service worker (11-22; DASH-34, DASH-36; T-11-22-02). A static script:
// push → showNotification (tag per type, renotify false); notificationclick → only same-origin
// /hub/ links. No caching and no offline (the hub is always live data). Registered by the
// Phone alerts card with scope /hub/ and updateViaCache "none"; `Service-Worker-Allowed`
// pins the widest scope it may take. Never cached, so a fix ships on the next visit.
import { HUB_SERVICE_WORKER } from "../../../../lib/hub-pwa";

export const dynamic = "force-dynamic";

export function GET(): Response {
  return new Response(HUB_SERVICE_WORKER, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Service-Worker-Allowed": "/hub/",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

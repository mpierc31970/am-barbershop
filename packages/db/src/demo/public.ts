// Public demo link reader (15-07; HUB-01, D209, D293). The hub's live-demo panel links to the
// permanent demo tenant "Bella's Salon" on its preview host. Read under a superuser, but it
// only ever returns that one URL: the org must have slug DEMO_SLUG **and** demo === true
// (T-15-07-02), and the URL is its `org_hosts` row with kind "preview". Any absence or error
// returns null (the panel hides); errors are logged by class name only.
// The 60 s cached wrapper `demoSiteUrl()` lives in apps/web/lib/marketing-catalog.ts (15-13;
// Next `unstable_cache` belongs in apps/web).
import { withSuperuser } from "../client";
import { DEMO_SLUG } from "./seed";

const HOST_RE = /^[a-z0-9.-]+(:\d{1,5})?$/i;

/** `https://<demo preview host>/`, or null when there is no demo tenant (or the read fails). */
export async function readDemoSiteUrl(): Promise<string | null> {
  try {
    return await withSuperuser(async (pb) => {
      const orgs = await pb.collection("organizations").getList(1, 1, {
        filter: pb.filter("slug = {:slug}", { slug: DEMO_SLUG }),
        fields: "id,demo",
      });
      const org = orgs.items[0];
      if (!org || org.demo !== true) return null;
      const hosts = await pb.collection("org_hosts").getList(1, 1, {
        filter: pb.filter("organization = {:org} && kind = 'preview'", {
          org: org.id,
        }),
        sort: "-primary,created",
        fields: "hostname",
      });
      const host = hosts.items[0]?.hostname;
      if (typeof host !== "string" || !HOST_RE.test(host)) return null;
      return `https://${host.toLowerCase()}/`;
    });
  } catch (err) {
    console.error(
      `[demo] demo site url unavailable (${err instanceof Error ? err.name : typeof err})`,
    );
    return null;
  }
}

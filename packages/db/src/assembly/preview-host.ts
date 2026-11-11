// P8 (08-11, R-4): platform-assigned preview host; since P14 (14-15, DOM-01) signup writes it
// in the signup batch and backfillPreviewHosts covers older orgs;
// preview = noindex + strip (D57, D170). TMPL-02 ("reviewable"); T-08-11-02.
//
// An org with no org_hosts row gets `<org-slug>.<suffix>` (kind preview, primary). An org
// that already has any host is never touched, and a hostname another org owns is never
// reassigned (the unique hostname index backs this up). The name is built only from the
// org's unique slug and the platform suffix, then checked with the same normalizeHost /
// classifyHost the request router uses, against PLATFORM_HOSTS parsed the way the app does.
// Internal: the orchestrator (08-16) calls it with the org id of a context it already minted.
import {
  classifyHost,
  InvalidInput,
  normalizeHost,
  NotFound,
  parsePlatformHosts,
} from "@cds/core";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { withSuperuser } from "../client";
import { assertId, mapError } from "../repository";

const ENV = "CDS_PREVIEW_HOST_SUFFIX";
const PROD_SUFFIX = "sites.connectionsdesignstudios.com";
const DEV_SUFFIX = "sites.localhost";
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * The preview host suffix: CDS_PREVIEW_HOST_SUFFIX, else the CDS preview domain in
 * production (CDS_ENV=production) and `sites.localhost` elsewhere. Normalised; anything
 * that is not a DNS name (or is an IP literal) throws, naming the variable.
 */
export function previewHostSuffix(): string {
  const raw = process.env[ENV]?.trim();
  const fallback =
    process.env.CDS_ENV === "production" ? PROD_SUFFIX : DEV_SUFFIX;
  const value = raw ? normalizeHost(raw) : fallback;
  const labels = value?.split(".") ?? [];
  const last = labels[labels.length - 1] ?? "";
  if (
    !value ||
    value.length > 200 ||
    labels.length < 1 ||
    !labels.every((l) => DNS_LABEL.test(l)) ||
    /^\d+$/.test(last)
  ) {
    throw new Error(`${ENV} must be a DNS name such as ${PROD_SUFFIX}`);
  }
  return value;
}

function pbRun<T>(fn: (pb: PocketBase) => Promise<T>): Promise<T> {
  return withSuperuser(fn).catch((err: unknown) => {
    if (err instanceof ClientResponseError) mapError(err);
    throw err;
  });
}

function primaryOf(rows: readonly RecordModel[]): string {
  const row = rows.find((r) => r.primary === true) ?? rows[0]!;
  return String(row.hostname);
}

/**
 * The preview hostname for an org slug: `<slug>.<previewHostSuffix()>` (14-15 choice 1).
 * Checked with the same normalizeHost / classifyHost the request router uses, so a slug
 * can never produce a platform or reserved host (T-14-15-01). Not a valid tenant host:
 * InvalidInput, and the caller writes nothing.
 */
export function previewHostFor(slug: string): string {
  if (typeof slug !== "string" || slug === "" || !DNS_LABEL.test(slug)) {
    throw new InvalidInput("This organization's preview address isn't valid.");
  }
  const hostname = `${slug}.${previewHostSuffix()}`;
  const platform = parsePlatformHosts(process.env.PLATFORM_HOSTS);
  const cls = classifyHost(hostname, platform);
  if (normalizeHost(hostname) !== hostname || cls.kind !== "tenant") {
    throw new InvalidInput("This organization's preview address isn't valid.");
  }
  return hostname;
}

/**
 * The org's primary hostname, creating its preview host first when it has none.
 * Since P14 (DOM-01) signup writes the preview row in its own batch, so for new orgs this
 * only reads; it still covers orgs created before P14 (see backfillPreviewHosts).
 * Unknown org: NotFound. A preview name another org owns (or one that is not a valid
 * tenant host): InvalidInput, and nothing is written.
 */
export async function ensurePreviewHost(orgId: string): Promise<string> {
  assertId(orgId);
  previewHostSuffix(); // config errors surface before any read
  return pbRun(async (pb) => {
    const own = await pb.collection("org_hosts").getFullList({
      filter: pb.filter("organization = {:org}", { org: orgId }),
      sort: "-primary,created,id",
    });
    if (own.length > 0) return primaryOf(own);

    const org = await pb
      .collection("organizations")
      .getList(1, 1, { filter: pb.filter("id = {:id}", { id: orgId }) });
    const slug = org.items[0]?.slug;
    if (org.items.length === 0) throw new NotFound();
    if (typeof slug !== "string" || slug === "") {
      throw new InvalidInput("This organization has no address name yet.");
    }
    const hostname = previewHostFor(slug);

    const taken = await pb.collection("org_hosts").getList(1, 1, {
      filter: pb.filter("hostname = {:h}", { h: hostname }),
    });
    if (taken.items.length > 0) {
      throw new InvalidInput("That preview address belongs to another site.");
    }
    await pb.collection("org_hosts").create({
      hostname,
      organization: orgId,
      kind: "preview",
      primary: true,
    });
    return hostname;
  });
}

export interface BackfillPreviewHostsResult {
  created: number;
  skipped: number;
  failed: number;
}

const BACKFILL_PAGE = 200;
const HOST_CHUNK = 50;

/**
 * DOM-01 backfill (P14-P3: the app-side reading of CONTEXT's "one-off backfill migration";
 * PocketBase cannot know the app's preview suffix). Gives up to `limit` active orgs that
 * have no org_hosts row their preview host. Idempotent and cheap, so `domains:run` (14-41)
 * runs it every 5 minutes. Counts only; a failing org is counted and logged by error class
 * name, never thrown. `skipped` counts hostless orgs left for a later run (over the limit).
 */
export async function backfillPreviewHosts(
  opts: { limit?: number; now?: () => Date } = {},
): Promise<BackfillPreviewHostsResult> {
  const limit = Math.max(0, Math.floor(opts.limit ?? 50));
  const out: BackfillPreviewHostsResult = { created: 0, skipped: 0, failed: 0 };
  const hostless = await pbRun(async (pb) => {
    const ids: string[] = [];
    for (let page = 1; ; page++) {
      const orgs = await pb
        .collection("organizations")
        .getList(page, BACKFILL_PAGE, {
          filter: 'status = "active"',
          sort: "created,id",
          fields: "id",
          skipTotal: true,
        });
      const pageIds = orgs.items.map((o) => String(o.id));
      for (let i = 0; i < pageIds.length; i += HOST_CHUNK) {
        const chunk = pageIds.slice(i, i + HOST_CHUNK);
        const filter = chunk
          .map((_, j) => `organization = {:o${j}}`)
          .join(" || ");
        const params = Object.fromEntries(chunk.map((id, j) => [`o${j}`, id]));
        const hosts = await pb.collection("org_hosts").getFullList({
          filter: pb.filter(filter, params),
          fields: "organization",
        });
        const have = new Set(hosts.map((h) => String(h.organization)));
        for (const id of chunk) if (!have.has(id)) ids.push(id);
      }
      if (orgs.items.length < BACKFILL_PAGE) break;
    }
    return ids;
  });
  for (const orgId of hostless) {
    if (out.created + out.failed >= limit) {
      out.skipped += 1;
      continue;
    }
    try {
      await ensurePreviewHost(orgId);
      out.created += 1;
    } catch (err) {
      out.failed += 1;
      console.error(
        `[preview-host] backfill failed: ${err instanceof Error ? err.constructor.name : "Error"}`,
      );
    }
  }
  return out;
}

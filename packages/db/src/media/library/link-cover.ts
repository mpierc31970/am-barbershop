// Link cover capture (07-23; CONT-34, RESEARCH Pitfall 7, D281, 07-23 choices 2-3; invariant 1,
// T-07-23-01/02/03). The only server-side fetch of provider content: fixed host, no redirects,
// capped in time and size, image types only, decoded by sharp through uploadLibraryImage.
// A pasted YouTube link's cover is copied ONCE per org and video into the tenant's own media
// library (source "link", name "youtube-<id>.jpg"), so the site never loads a provider
// thumbnail. Only providers with a fixed thumbnail URL (YouTube) get a cover (choice 3).
import { mediaLinkFrom, PROVIDER_LABELS } from "@cds/core/content";
import type { OrgContext } from "../../context";
import { requirePermission } from "../../repository";
import type { ObjectStore } from "../../storage";
import { cleanAlt } from "../assets";
import { AllowanceExceeded } from "../cdn/usage";
import { UploadRejected } from "../pipeline";
import { cleanFileName } from "./alt";
import { getLibraryItem } from "./list";
import { runContentRead } from "./run";
import { uploadLibraryImage } from "./upload";

const COLLECTION = "media_assets";

/** The only hosts a cover may be fetched from (exact match, https only). */
export const LINK_COVER_HOSTS: readonly string[] = Object.freeze([
  "i.ytimg.com",
]);
export const LINK_COVER_MAX_BYTES = 2 * 1024 * 1024;
export const LINK_COVER_TIMEOUT_MS = 5000;

const IMAGE_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp"]);
const TITLE_IN_ALT_MAX = 200;

export type LinkCoverResult =
  | { ok: true; asset: string; thumbUrl: string; reused: boolean }
  | { ok: false; reason: "none" | "unavailable" | "allowance" };

export type LinkCoverInput = {
  provider: unknown;
  providerId: unknown;
  title?: unknown;
};

export type LinkCoverDeps = {
  fetch?: typeof fetch;
  store?: ObjectStore;
  timeoutMs?: number;
};

/** A fetch/type/size/decode failure: never a row, never an object. */
class CoverUnavailable extends Error {}

function coverAlt(title: unknown, label: string): string {
  const t =
    typeof title === "string"
      ? title.replace(/\s+/g, " ").trim().slice(0, TITLE_IN_ALT_MAX).trim()
      : "";
  return cleanAlt(t === "" ? `Video cover from ${label}` : `Cover of "${t}"`);
}

async function readCapped(res: Response, cap: number): Promise<Uint8Array> {
  const body = res.body;
  if (!body) throw new CoverUnavailable();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      throw new CoverUnavailable();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

async function existingCover(
  ctx: OrgContext,
  name: string,
): Promise<string | null> {
  return runContentRead(ctx, async (pb) => {
    const res = await pb.collection(COLLECTION).getList(1, 1, {
      filter: pb.filter(
        "organization = {:org} && source = 'link' && name = {:name} && deleted_at = '' && removed_at = ''",
        { org: ctx.orgId, name },
      ),
      fields: "id",
      sort: "created,id",
    });
    return res.items[0]?.id ?? null;
  });
}

/** Copy a link's cover into the org's media library once; reuse it after that. */
export async function captureLinkCover(
  ctx: OrgContext,
  input: LinkCoverInput,
  deps: LinkCoverDeps = {},
): Promise<LinkCoverResult> {
  requirePermission(ctx, "content", "write");
  const link = mediaLinkFrom(input.provider, input.providerId);
  if (!link || !link.thumbnailUrl) return { ok: false, reason: "none" };
  let url: URL;
  try {
    url = new URL(link.thumbnailUrl);
  } catch {
    return { ok: false, reason: "none" };
  }
  if (url.protocol !== "https:" || !LINK_COVER_HOSTS.includes(url.hostname)) {
    return { ok: false, reason: "none" };
  }
  const name = cleanFileName(`${link.provider}-${link.id}.jpg`);
  const reuse = await existingCover(ctx, name);
  if (reuse) {
    const item = await getLibraryItem(ctx, reuse);
    return {
      ok: true,
      asset: reuse,
      thumbUrl: item.thumbUrl ?? "",
      reused: true,
    };
  }

  const doFetch = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? LINK_COVER_TIMEOUT_MS;
  let bytes: Uint8Array;
  try {
    const res = await doFetch(url.href, {
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "image/*" },
    });
    if (!res.ok) throw new CoverUnavailable();
    const type = (res.headers.get("content-type") ?? "")
      .split(";")[0]!
      .trim()
      .toLowerCase();
    if (!IMAGE_TYPES.includes(type)) throw new CoverUnavailable();
    bytes = await readCapped(res, LINK_COVER_MAX_BYTES);
  } catch {
    console.warn(`[media] link cover unavailable ${link.provider}`);
    return { ok: false, reason: "unavailable" };
  }

  try {
    const { asset } = await uploadLibraryImage(ctx, bytes, {
      alt: coverAlt(input.title, PROVIDER_LABELS[link.provider]),
      filename: name,
      source: "link",
      ...(deps.store ? { store: deps.store } : {}),
    });
    const item = await getLibraryItem(ctx, asset.id);
    return {
      ok: true,
      asset: asset.id,
      thumbUrl: item.thumbUrl ?? "",
      reused: false,
    };
  } catch (err) {
    if (err instanceof AllowanceExceeded)
      return { ok: false, reason: "allowance" };
    if (err instanceof UploadRejected) {
      console.warn(`[media] link cover unavailable ${link.provider}`);
      return { ok: false, reason: "unavailable" };
    }
    throw err;
  }
}

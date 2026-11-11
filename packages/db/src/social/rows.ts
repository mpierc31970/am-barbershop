// Shared internals of the social repository (11-35; DASH-14, DASH-15; Pitfall 3). Not
// re-exported from the social barrel: accounts.ts, short-links.ts, the site-context reader
// and the intake business profile use these with their own superuser client.
//
//   - readSocialRows(): the org's social_accounts rows in display order (bound filter)
//   - linkOfRow(): one row as a SocialLink. A preset projects to its key; a custom account to
//     "other" with its name as `label` (the shape the footer, the Social block and JSON-LD
//     sameAs already read)
//   - the short-code cache (60 s per org; every write clears it in-process, tag org:<id>:social)
import { InvalidInput } from "@cds/core";
import { SOCIAL_PLATFORMS, type SocialLink } from "@cds/core/intake";
import {
  CUSTOM_LABEL_MAX,
  CUSTOM_PLATFORM,
  PRESET_CODES,
  SOCIAL_COPY,
  bioLinkPath,
  customCodeFor,
  findPreset,
  socialUrlErrorCopy,
  validateSocialUrl,
  type SocialAccount,
} from "@cds/core/social";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";

export const SOCIAL_COLLECTION = "social_accounts";

/** Cache tag of an org's social accounts (footer icons, short codes). */
export function socialTag(orgId: string): string {
  return `org:${orgId}:social`;
}

export function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function readSocialRows(
  pb: PocketBase,
  orgId: string,
): Promise<RecordModel[]> {
  const filter = pb.filter("organization = {:org}", { org: orgId });
  return pb
    .collection(SOCIAL_COLLECTION)
    .getFullList({ filter, sort: "order,created,id" });
}

/** A row as the intake / site link shape, or null for an unknown platform. */
export function linkOfRow(r: RecordModel): SocialLink | null {
  const platform = str(r.platform);
  const url = str(r.url).trim();
  if (url === "") return null;
  if (platform === CUSTOM_PLATFORM) {
    const label = str(r.label).trim();
    return label
      ? { platform: "other", url, label }
      : { platform: "other", url };
  }
  if (
    findPreset(platform) &&
    (SOCIAL_PLATFORMS as readonly string[]).includes(platform)
  ) {
    return { platform: platform as SocialLink["platform"], url };
  }
  return null;
}

export function linksOfRows(rows: readonly RecordModel[]): SocialLink[] {
  const out: SocialLink[] = [];
  for (const r of rows) {
    const link = linkOfRow(r);
    if (link) out.push(link);
  }
  return out;
}

// ---- Short-code cache (11-35 choice 3) ----

export type ShortCodeMap = {
  /** Preset code at the site root -> platform; never a code a page owns (the page wins). */
  root: ReadonlyMap<string, string>;
  /** /go/<code> -> platform, for every account. */
  go: ReadonlyMap<string, string>;
};

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; map: ShortCodeMap }>();

export function cachedShortCodes(orgId: string): ShortCodeMap | null {
  const hit = cache.get(orgId);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(orgId);
    return null;
  }
  return hit.map;
}

export function storeShortCodes(orgId: string, map: ShortCodeMap): void {
  cache.set(orgId, { at: Date.now(), map });
}

/** Every social write calls this (in-process; other processes self-heal in 60 s). */
export function clearSocialCache(orgId: string): void {
  cache.delete(orgId);
}

// ---------------------------------------------------------------------------------------
// Internals shared with the intake writer

/** Hostnames of the org (preview and live): a custom link may not point at them. */
export async function ownHostsOf(
  pb: PocketBase,
  orgId: string,
): Promise<string[]> {
  const filter = pb.filter("organization = {:org}", { org: orgId });
  const rows = await pb
    .collection("org_hosts")
    .getFullList({ filter, fields: "hostname" });
  return rows.map((r) => str(r.hostname)).filter((h) => h !== "");
}

/** validateSocialUrl against every own host; InvalidInput with the UI-SPEC line on failure. */
export function checkSocialUrl(
  platform: string,
  raw: unknown,
  ownHosts: readonly string[],
): string {
  if (typeof raw !== "string") throw new InvalidInput(SOCIAL_COPY.invalid);
  const hosts = ownHosts.length > 0 ? ownHosts : [null];
  let url = "";
  for (const ownHost of hosts) {
    const r = validateSocialUrl(platform, raw, { ownHost });
    if (!r.ok) {
      if (r.reason === "host" && platform === CUSTOM_PLATFORM) {
        throw new InvalidInput(SOCIAL_COPY.ownHost);
      }
      throw new InvalidInput(socialUrlErrorCopy(platform, r.reason));
    }
    url = r.url;
  }
  return url;
}

export function labelOf(raw: unknown): string {
  if (typeof raw !== "string") throw new InvalidInput(SOCIAL_COPY.label);
  const v = raw.trim();
  if (v === "") throw new InvalidInput(SOCIAL_COPY.label);
  if (/[\u0000-\u001f\u007f-\u009f]/.test(v)) {
    throw new InvalidInput(SOCIAL_COPY.label);
  }
  if (v.length > CUSTOM_LABEL_MAX) {
    throw new InvalidInput(SOCIAL_COPY.labelLength);
  }
  return v;
}

/** The short code a new account gets (preset code, or a free custom code). */
export function codeFor(
  platform: string,
  label: string,
  taken: readonly string[],
): string {
  const preset = findPreset(platform);
  if (preset && !taken.includes(preset.code)) return preset.code;
  return customCodeFor(label || preset?.label || "link", taken);
}

/** Non-deleted page slugs of the org that equal a preset code (the page wins). */
export async function pageOwnedCodes(
  pb: PocketBase,
  orgId: string,
): Promise<Set<string>> {
  const filter = pb.filter("organization = {:org} && deleted_at = ''", {
    org: orgId,
  });
  const rows = await pb
    .collection("pages")
    .getFullList({ filter, fields: "slug" });
  const out = new Set<string>();
  for (const r of rows) {
    const slug = str(r.slug);
    if (PRESET_CODES.includes(slug)) out.add(slug);
  }
  return out;
}

/** True when the account uses its preset's fixed root code (not a /go/ fallback code). */
function usesPresetCode(platform: string, code: string): boolean {
  const p = findPreset(platform);
  return Boolean(p && p.code === code);
}

export function toSocialAccount(
  r: RecordModel,
  pageCodes: ReadonlySet<string>,
): SocialAccount {
  const platform = str(r.platform);
  const preset = findPreset(platform);
  const shortCode = str(r.short_code);
  const label = preset ? "" : str(r.label);
  const presetCode = usesPresetCode(platform, shortCode);
  const fallback = presetCode && pageCodes.has(shortCode);
  return {
    id: r.id,
    platform,
    name: preset ? preset.label : label || "Other",
    label,
    url: str(r.url),
    shortCode,
    order: typeof r.order === "number" ? r.order : 0,
    fallback,
    bioPath: presetCode
      ? bioLinkPath({ platform, short_code: shortCode, fallback })
      : `/go/${shortCode}`,
  };
}

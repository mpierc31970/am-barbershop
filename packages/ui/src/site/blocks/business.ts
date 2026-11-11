// Defensive read of coreData.business for the hours, social and map blocks (07-24; D253;
// T-07-24-01). coreData.business is typed Readonly<Record<string, unknown>>: never trust its
// shape. Strings default to "", hours survive only with all 7 day keys (boolean open, array
// ranges), socials keep only http(s) urls of known platforms.
// Pure: server-safe and island-safe.
import { DAYS, SOCIAL_PLATFORMS, type WeeklyHours } from "@cds/core/intake";
import type { CoreBoundData } from "../types";

export type PublicBusinessView = {
  name: string;
  phone: string;
  publicEmail: string;
  address: { street: string; city: string; state: string; zip: string };
  timeZone: string;
  hours: WeeklyHours | null;
  socials: { platform: string; url: string; label?: string }[];
};

const own = (o: object, k: string): unknown =>
  Object.prototype.hasOwnProperty.call(o, k)
    ? (o as Record<string, unknown>)[k]
    : undefined;

const isObj = (v: unknown): v is object =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (o: object, k: string): string => {
  const v = own(o, k);
  return typeof v === "string" ? v.trim() : "";
};

function readHours(v: unknown): WeeklyHours | null {
  if (!isObj(v)) return null;
  for (const day of DAYS) {
    const d = own(v, day);
    if (!isObj(d)) return null;
    if (
      typeof own(d, "open") !== "boolean" ||
      !Array.isArray(own(d, "ranges"))
    ) {
      return null;
    }
  }
  return v as WeeklyHours;
}

function httpUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

function readSocials(
  v: unknown,
): { platform: string; url: string; label?: string }[] {
  if (!Array.isArray(v)) return [];
  const out: { platform: string; url: string; label?: string }[] = [];
  for (const s of v as unknown[]) {
    if (!isObj(s)) continue;
    const platform = own(s, "platform");
    if (
      typeof platform !== "string" ||
      !(SOCIAL_PLATFORMS as readonly string[]).includes(platform)
    ) {
      continue;
    }
    const url = httpUrl(own(s, "url"));
    if (!url) continue;
    // 11-35: a custom social account ("other") carries its name.
    const label = own(s, "label");
    const name =
      platform === "other" && typeof label === "string"
        ? label.trim().slice(0, 40)
        : "";
    out.push(name ? { platform, url, label: name } : { platform, url });
  }
  return out;
}

export function readBusiness(
  coreData: CoreBoundData | undefined,
): PublicBusinessView | null {
  const b = coreData?.business;
  if (!isObj(b)) return null;
  const a = own(b, "address");
  const addr = isObj(a) ? a : {};
  return {
    name: str(b, "name"),
    phone: str(b, "phone"),
    publicEmail: str(b, "public_email"),
    address: {
      street: str(addr, "street"),
      city: str(addr, "city"),
      state: str(addr, "state"),
      zip: str(addr, "zip"),
    },
    timeZone: str(b, "time_zone"),
    hours: readHours(own(b, "hours")),
    socials: readSocials(own(b, "socials")),
  };
}

/** True when some day has at least one opening range. */
export function businessHasHours(hours: WeeklyHours | null): boolean {
  if (!hours) return false;
  return DAYS.some((d) => hours[d].open && hours[d].ranges.length > 0);
}

/** "tel:" href from a phone: the shared core helper (extension as `;ext=`, CR-B02). */
export { telHref } from "@cds/core/content";

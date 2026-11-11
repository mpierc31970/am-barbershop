// Defensive readers and text helpers for the Services and Our team blocks (08-05; D253,
// D-UI-P8-14, -17, -18, -19; T-08-05-02, -04). coreData comes from the app loader (08-08)
// as a published-only projection, but its shape is still never trusted: rows without an id
// or name are dropped, unknown price types read as "ask", the team is cut to 24.
// Pure: server-safe.
import type {
  CoreBoundData,
  PublicService,
  PublicTeamMember,
  ResolvedMedia,
} from "../types";

/** UI-SPEC: Our team renders at most 24 members. */
export const TEAM_MAX = 24;

const PRICE_TYPES = ["fixed", "from", "free", "ask"] as const;

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

const num = (o: object, k: string): number | null => {
  const v = own(o, k);
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

export function readServices(
  coreData: CoreBoundData | undefined,
): PublicService[] {
  const list = coreData?.services;
  if (!Array.isArray(list)) return [];
  const out: PublicService[] = [];
  for (const s of list as unknown[]) {
    if (!isObj(s)) continue;
    const id = str(s, "id");
    const name = str(s, "name");
    if (!id || !name) continue;
    const pt = own(s, "price_type");
    out.push({
      id,
      name,
      description: str(s, "description"),
      price_type: (PRICE_TYPES as readonly unknown[]).includes(pt)
        ? (pt as PublicService["price_type"])
        : "ask",
      price_cents: num(s, "price_cents"),
      duration_minutes: num(s, "duration_minutes"),
    });
  }
  return out;
}

function readPhoto(v: unknown): ResolvedMedia | undefined {
  if (!isObj(v)) return undefined;
  const m = v as ResolvedMedia;
  if (m.kind !== "image" || m.deleted === true) return undefined;
  if (typeof m.src !== "string" || m.src === "") return undefined;
  return m;
}

export function readTeam(
  coreData: CoreBoundData | undefined,
): PublicTeamMember[] {
  const list = coreData?.team;
  if (!Array.isArray(list)) return [];
  const out: PublicTeamMember[] = [];
  for (const m of list as unknown[]) {
    if (out.length >= TEAM_MAX) break;
    if (!isObj(m)) continue;
    const id = str(m, "id");
    const name = str(m, "name");
    if (!id || !name) continue;
    const photo = readPhoto(own(m, "photo"));
    out.push({
      id,
      name,
      role: str(m, "role"),
      bio: str(m, "bio"),
      ...(photo ? { photo } : {}),
    });
  }
  return out;
}

/** "$45", "$45.50": no cents when whole (P6 rule). "" when not a usable amount. */
function money(cents: number | null): string {
  if (cents === null || !Number.isFinite(cents) || cents < 0) return "";
  const whole = Math.round(cents) % 100 === 0;
  return `$${(Math.round(cents) / 100).toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`;
}

/** Visitor price words (D-UI-P8-18). "" when a priced type has no amount. */
export function priceText(
  type: PublicService["price_type"],
  cents: number | null,
): string {
  switch (type) {
    case "free":
      return "Free";
    case "ask":
      return "Ask for a price";
    case "from": {
      const m = money(cents);
      return m ? `From ${m}` : "";
    }
    default:
      return money(cents);
  }
}

/** Duration in words, no abbreviations (D-UI-P8-19). "" when none. */
export function durationText(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) return "";
  const m = Math.round(minutes);
  if (m >= 60 && m % 60 === 0) {
    const h = m / 60;
    return h === 1 ? "1 hour" : `${h} hours`;
  }
  return m === 1 ? "1 minute" : `${m} minutes`;
}

/** First letters of the first and last word, max 2, uppercased. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const first = Array.from(words[0]!)[0] ?? "";
  const last =
    words.length > 1 ? (Array.from(words[words.length - 1]!)[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

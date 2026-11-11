// Settings › People & roles view data (11-39; D285). Server-only: maps the chokepoint's
// listPeople / listInvites rows into the client view shapes (@cds/ui/hub/people), formats
// "sent 9 Oct" in the business time zone, and lists the org's active add-ons as the access
// options (a grant is an add-on slug; only active add-ons are offered or accepted, T-11-39-02).
import { ADDON_REGISTRY } from "@cds/addon-registry";
import {
  activeAddons,
  listInvites,
  listPeople,
  statsTimeZone,
  type OrgContext,
} from "@cds/db";
import type {
  AddonAccessOption,
  InviteView,
  PeopleLists,
  PeopleRole,
  PersonView,
} from "@cds/ui/hub/people";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const ROLES: readonly PeopleRole[] = [
  "owner",
  "admin",
  "editor",
  "viewer",
  "staff",
  "renter",
];

function roleOf(v: string): PeopleRole {
  return (ROLES as readonly string[]).includes(v)
    ? (v as PeopleRole)
    : "viewer";
}

/** "9 Oct" in `timeZone` (built by hand: en-GB prints "Sept"). "" for a bad date. */
export function dayMonth(iso: string, timeZone: string): string {
  const d = new Date(iso.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "";
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      day: "numeric",
      month: "numeric",
    }).formatToParts(d);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      day: "numeric",
      month: "numeric",
    }).formatToParts(d);
  }
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  const month = Number(parts.find((p) => p.type === "month")?.value ?? "0");
  const name = MONTHS[month - 1];
  return day && name ? `${day} ${name}` : "";
}

async function timeZoneOf(ctx: OrgContext): Promise<string> {
  try {
    return (await statsTimeZone(ctx)) || "UTC";
  } catch {
    return "UTC";
  }
}

/** People and pending invites, as the table shows them. */
export async function loadPeopleLists(ctx: OrgContext): Promise<PeopleLists> {
  const [people, invites, tz] = await Promise.all([
    listPeople(ctx),
    listInvites(ctx),
    timeZoneOf(ctx),
  ]);
  return {
    people: people.map((p): PersonView => ({
      id: p.membershipId,
      name: p.name,
      email: p.email,
      role: p.role,
      grants: p.addonGrants,
      isYou: p.isYou,
    })),
    invites: invites.map((i): InviteView => ({
      id: i.id,
      email: i.email,
      role: roleOf(i.role),
      grants: i.grants,
      sentOn: dayMonth(i.created, tz),
      expired: i.expired,
    })),
  };
}

/** Active add-ons in registry order: the Add-on access choices. */
export async function addonAccessOptions(
  ctx: OrgContext,
): Promise<AddonAccessOption[]> {
  const active = await activeAddons(ctx);
  return ADDON_REGISTRY.list()
    .filter((m) => active.includes(m.slug))
    .map((m) => ({ slug: m.slug, name: m.name }));
}

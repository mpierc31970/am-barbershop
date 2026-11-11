// Site footer rules (CONT-13; D117 / invariant 6, D248, D249, D253; CONTEXT Area 5 row 1;
// 07-25 choices 1-2, 14). Owner 07-25; 07-29 snapshots the stored shape.
//
// The footer is site chrome stored in site_settings.footer. Deny by default: fresh objects
// from own properties only; extra links follow the menu's link rules (page id or http(s)
// URL, never a pop-up, no children). The Report link (D249) is NOT a setting: nothing here
// can describe, hide or move it; the visitor footer always renders it.
//
// resolveFooter returns render data. Hours are passed through raw (weekly + time zone):
// the visitor footer formats them with 07-24's hoursRows, so there is one hours formatter.
// Pure and Edge-safe: no node:, no sanitizer, no next/* imports.
import { InvalidInput } from "../../errors";
import type { Address, SocialLink, WeeklyHours } from "../../intake/snapshot";
import { safeHref } from "../validate";
import { asRecord, own } from "../validate-helpers";
import {
  resolveNavLink,
  validateNavLink,
  NAV_COPY,
  type NavLink,
  type NavResolveInput,
  type ResolvedNavLink,
} from "./nav";

export const FOOTER_LINKS_MAX = 6;
export const FOOTER_COPYRIGHT_MAX = 120;

export const FOOTER_COPY = Object.freeze({
  saved: "Footer saved. It's live on your site.",
  reportNote:
    "Every footer has a small Report link that lets visitors tell CDS about a problem. It can't be removed.",
  copyrightHelp: "The year updates itself when you use {year}.",
  linksLimit: "Footers hold up to 6 extra links.",
  held: "Your footer is waiting for a quick review. Until then your site shows the standard copyright line and no extra links.",
});

/** Visible text of the un-removable Report link (D249, D-UI-P7-30). */
export const REPORT_LABEL = "Report";
/** Its accessible name (D-UI-P7-30). */
export const REPORT_ARIA_LABEL = "Report this site to CDS";

export type FooterSettings = {
  show_address: boolean;
  show_hours: boolean;
  show_socials: boolean;
  extra_links: NavLink[];
  /** "" = the default "© {year} {business name}". */
  copyright: string;
  held: boolean;
};

function flag(r: Record<string, unknown>, key: string): boolean {
  const v = own(r, key);
  return typeof v === "boolean" ? v : true;
}

/** Deny-by-default footer validation: switches default on, `held` only from own boolean. */
export function validateFooter(raw: unknown): FooterSettings {
  const r = asRecord(raw);
  const rawLinks = own(r, "extra_links");
  const links = Array.isArray(rawLinks) ? rawLinks : [];
  if (links.length > FOOTER_LINKS_MAX) {
    throw new InvalidInput(FOOTER_COPY.linksLimit);
  }
  const seen = new Set<string>();
  const extra_links = links.map((l) => {
    const link = validateNavLink(l);
    if (seen.has(link.id)) throw new InvalidInput(NAV_COPY.duplicate);
    seen.add(link.id);
    return link;
  });
  const c = own(r, "copyright");
  const copyright = typeof c === "string" ? c.trim() : "";
  if (copyright.length > FOOTER_COPYRIGHT_MAX) {
    throw new InvalidInput(
      `Keep this under ${FOOTER_COPYRIGHT_MAX} characters.`,
    );
  }
  return {
    show_address: flag(r, "show_address"),
    show_hours: flag(r, "show_hours"),
    show_socials: flag(r, "show_socials"),
    extra_links,
    copyright,
    held: own(r, "held") === true,
  };
}

/** The copyright line: `{year}` tokens filled; "" means "© {year} {name}". */
export function copyrightText(
  copyright: string,
  input: { name: string; year: number },
): string {
  const year = String(input.year);
  const name = input.name.trim();
  if (copyright.trim() === "")
    return name === "" ? `© ${year}` : `© ${year} ${name}`;
  return copyright.replace(/\{year\}/g, year);
}

/** "12 Oak St" / "Austin, TX 78701"; blank parts are skipped. */
export function formatAddressLines(address: Partial<Address> | null): string[] {
  if (!address) return [];
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const street = s(address.street);
  const city = s(address.city);
  const state = s(address.state);
  const zip = s(address.zip);
  const region = [state, zip].filter((p) => p !== "").join(" ");
  const line2 = [city, region].filter((p) => p !== "").join(", ");
  return [street, line2].filter((p) => p !== "");
}

/** What the footer needs from the business profile (structurally PublicBusiness). */
export type FooterBusinessInput = {
  name: string;
  phone: string;
  public_email: string;
  address: Partial<Address> | null;
  time_zone: string;
  hours: WeeklyHours | null;
  socials: SocialLink[];
};

export type ResolvedFooter = {
  name: string;
  addressLines: string[];
  phone: string;
  email: string;
  /** 11-35: from social_accounts; `label` names a custom ("other") account. */
  socials: { platform: string; url: string; label?: string }[];
  hours: { weekly: WeeklyHours; timeZone: string } | null;
  links: ResolvedNavLink[];
  copyright: string;
};

export type FooterResolveInput = Omit<NavResolveInput, "held"> & {
  business: FooterBusinessInput;
  year: number;
};

export const DEFAULT_FOOTER: FooterSettings = Object.freeze({
  show_address: true,
  show_hours: true,
  show_socials: true,
  extra_links: [],
  copyright: "",
  held: false,
}) as FooterSettings;

function httpOnly(url: string): string {
  try {
    const href = safeHref(url);
    return /^https?:\/\//i.test(href) ? href : "";
  } catch {
    return "";
  }
}

/** Stored footer (null = defaults) -> render data honouring the three switches. */
export function resolveFooter(
  footer: FooterSettings | null | undefined,
  input: FooterResolveInput,
): ResolvedFooter {
  const f = footer ?? DEFAULT_FOOTER;
  const b = input.business;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const links = f.held
    ? []
    : f.extra_links
        .map((l) => resolveNavLink(l, input, false))
        .filter((l): l is ResolvedNavLink => l !== null);
  const socials = f.show_socials
    ? (b.socials ?? [])
        .map((s) => {
          const url = httpOnly(s.url);
          const label =
            typeof s.label === "string" ? s.label.trim().slice(0, 40) : "";
          return label
            ? { platform: s.platform, url, label }
            : { platform: s.platform, url };
        })
        .filter((s) => s.url !== "")
    : [];
  return {
    name,
    addressLines: f.show_address ? formatAddressLines(b.address) : [],
    phone: typeof b.phone === "string" ? b.phone.trim() : "",
    email: typeof b.public_email === "string" ? b.public_email.trim() : "",
    socials,
    hours:
      f.show_hours && b.hours
        ? { weekly: b.hours, timeZone: b.time_zone }
        : null,
    links,
    copyright: copyrightText(f.held ? "" : f.copyright, {
      name,
      year: input.year,
    }),
  };
}

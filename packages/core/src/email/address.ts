// Email address helpers and the free-mail list (ONB-10, D173). Pure.
import { InvalidInput } from "../errors";

export const ERR_EMAIL =
  "That doesn't look like an email address. Check it and try again.";

/** Consumer mailbox providers: never used as a From domain (D173). */
export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "rocketmail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.net",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "fastmail.com",
  "hey.com",
  "tutanota.com",
]);

const LOCAL = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64}$/;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function domainOk(domain: string): boolean {
  if (domain.length > 253) return false;
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  if (!/^[a-z]{2,63}$/.test(labels[labels.length - 1]!)) return false;
  return labels.every((l) => LABEL.test(l));
}

function check(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (v.length > 254) return null;
  const at = v.lastIndexOf("@");
  if (at <= 0 || at !== v.indexOf("@")) return null;
  const local = v.slice(0, at);
  const domain = v.slice(at + 1);
  if (!LOCAL.test(local) || local.startsWith(".") || local.endsWith(".")) {
    return null;
  }
  if (local.includes("..") || !domainOk(domain)) return null;
  return v;
}

/** Trim + lower-case; throws InvalidInput with the ERR-EMAIL copy. */
export function normaliseEmail(raw: unknown): string {
  const v = check(raw);
  if (v === null) throw new InvalidInput(ERR_EMAIL);
  return v;
}

export function isEmail(raw: unknown): boolean {
  return check(raw) !== null;
}

export function emailDomain(address: string): string {
  const at = address.lastIndexOf("@");
  return address
    .slice(at + 1)
    .trim()
    .toLowerCase();
}

/** Accepts an address or a bare domain. */
export function isFreeMail(address: string): boolean {
  return FREE_MAIL_DOMAINS.has(emailDomain(address));
}

/** A bare lower-case domain name (no scheme, no path), or null. */
export function isDomainName(raw: string): boolean {
  return domainOk(raw);
}

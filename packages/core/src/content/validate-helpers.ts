// Deny-by-default validator helpers (07-02, Finding 2; T-03-04, T-03-05, T-07-02-05).
//
// Shared by content/validate.ts, content/blocks/* and content/items/*. The rules every
// helper keeps: build fresh objects (raw input is never spread or cloned), read own
// properties only (prototype keys and inherited getters are never consulted), coerce,
// trim and length-cap every string. Pure and Edge-safe: no node:, no sanitizer, no next/*.
//
// Re-exported from @cds/core/content only as the `contentValidators` namespace, because
// names like `text` and `own` are too generic for the flat barrel. Block and item files
// import them relatively (`../validate-helpers`).
import { InvalidInput } from "../errors";
import { newId } from "./columns";

export const MAX_TEXT = 500;
export const MAX_RICH_TEXT = 20000;
export const MAX_LIST_ITEMS = 50;

export const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const MALFORMED_COPY = "This block's content is malformed.";
export const ALT_COPY =
  "Add a short description of the image for people who can't see it.";

export type Raw = Record<string, unknown>;

export function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** undefined/null -> {}; any other non-object -> InvalidInput. */
export function asRecord(value: unknown): Raw {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new InvalidInput(MALFORMED_COPY);
  return value;
}

/** Own-property read, so prototype keys and inherited getters are never consulted. */
export function own(raw: Raw, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : undefined;
}

export function capped(value: string, max: number): string {
  if (value.length > max) {
    throw new InvalidInput(`Keep this under ${max} characters.`);
  }
  return value;
}

/** Plain text: string or "", trimmed, capped. */
export function text(raw: Raw, key: string, max = MAX_TEXT): string {
  const v = own(raw, key);
  return typeof v === "string" ? capped(v.trim(), max) : "";
}

/** Rich text html: string or "", capped (sanitized later by the db layer). */
export function richText(raw: Raw, key: string): string {
  const v = own(raw, key);
  return typeof v === "string" ? capped(v, MAX_RICH_TEXT) : "";
}

export function stringList(raw: Raw, key: string): string[] {
  const v = own(raw, key);
  if (!Array.isArray(v)) return [];
  if (v.length > MAX_LIST_ITEMS) {
    throw new InvalidInput(`Keep lists to ${MAX_LIST_ITEMS} items or fewer.`);
  }
  return v
    .filter((s): s is string => typeof s === "string")
    .map((s) => capped(s.trim(), MAX_TEXT));
}

export function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export function safeId(value: unknown): string {
  return typeof value === "string" && SAFE_ID.test(value) ? value : newId();
}

/** Image url + alt pair: alt is required whenever a url is set. */
export function imagePair(url: string, alt: string): void {
  if (url !== "" && alt === "") throw new InvalidInput(ALT_COPY);
}

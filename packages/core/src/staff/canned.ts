// Canned reply placeholders and render (STAFF-09, D96; T-13-15-01). Pure and browser-safe.
// Stub from 13-02; body by 13-15. The token list is a closed allowlist: any other {token} is
// refused at save (staffSaveCanned) and at insert (renderCanned), never passed through.
import { InvalidInput } from "../errors";
import { P13_COPY, fillCopy } from "./copy";

/** The only placeholders a canned reply may use. */
export const CANNED_TOKENS = [
  "first_name",
  "business",
  "ticket",
  "agent",
] as const;
export type CannedToken = (typeof CANNED_TOKENS)[number];

/** Values filled on insert. `ticket` renders as "#1042" (a leading "#" is not doubled). */
export type CannedVars = {
  readonly first_name: string;
  readonly business: string;
  readonly ticket: number | string;
  readonly agent: string;
};

const TOKEN_RE = /\{([a-z_]+)\}/g;

export function isCannedToken(v: string): v is CannedToken {
  return (CANNED_TOKENS as readonly string[]).includes(v);
}

/** Every `{token}` in `body`, in first-seen order, each once (known or not). */
export function cannedPlaceholders(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(TOKEN_RE)) {
    const name = m[1] ?? "";
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/** Throws InvalidInput (PLACEHOLDER-UNKNOWN) naming the first token outside the allowlist. */
export function assertCannedPlaceholders(body: string): void {
  const unknown = cannedPlaceholders(body).find((t) => !isCannedToken(t));
  if (unknown !== undefined) {
    throw new InvalidInput(
      fillCopy(P13_COPY.PLACEHOLDER_UNKNOWN, { token: `{${unknown}}` }),
    );
  }
}

function ticketLabel(v: number | string): string {
  const s = String(v).trim();
  return s.startsWith("#") ? s : `#${s}`;
}

/**
 * Fill every placeholder in one pass (values are never re-scanned, so a name containing
 * "{business}" stays literal). Unknown tokens are refused before anything is filled.
 */
export function renderCanned(body: string, vars: CannedVars): string {
  assertCannedPlaceholders(body);
  return fillKnownCanned(body, vars);
}

/**
 * Free-typed text (the staff composer, WR-E09): fill the four known placeholders in one pass
 * and leave any other `{word}` exactly as typed (a quoted page title, a template snippet, a log
 * line). Never throws.
 */
export function fillKnownCanned(body: string, vars: CannedVars): string {
  const values: Record<CannedToken, string> = {
    first_name: vars.first_name,
    business: vars.business,
    ticket: ticketLabel(vars.ticket),
    agent: vars.agent,
  };
  return body.replace(TOKEN_RE, (whole, name: string) =>
    isCannedToken(name) ? values[name] : whole,
  );
}

// Ticket numbers (COMM-07, P12-P2). Numbers start at 1001. Junk input is NotFound, never
// InvalidInput, so a URL probe cannot tell "malformed" from "not yours" (T-12-03-01).
import { NotFound } from "../errors";

export const TICKET_NUMBER_START = 1001;

/** A decimal integer ≥ 1001 (from a URL segment or CLI flag; a leading "#" is allowed). */
export function parseTicketNumber(raw: unknown): number {
  if (typeof raw !== "string" && typeof raw !== "number") {
    throw new NotFound("ticket not found");
  }
  const s = String(raw).trim().replace(/^#/, "");
  if (!/^[1-9]\d{0,9}$/.test(s)) throw new NotFound("ticket not found");
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < TICKET_NUMBER_START) {
    throw new NotFound("ticket not found");
  }
  return n;
}

/** "#1042". */
export function formatTicketNumber(n: number): string {
  return `#${n}`;
}

// Ticket rating rules (STAFF-21, D212, P13-P18; 13-16 choice 1). Pure and browser-safe: who
// may rate a ticket, the comment cap, and the thumbs-up rate the console report shows.
import type { OrgRole } from "../roles";
import type { TicketStatus } from "./types";

/** Optional comment cap (CONTEXT Area 5: ≤ 500). */
export const RATING_COMMENT_MAX = 500;

export const RATING_CHOICES = ["up", "down"] as const;
export type RatingChoice = (typeof RATING_CHOICES)[number];

export function isRatingChoice(v: unknown): v is RatingChoice {
  return v === "up" || v === "down";
}

const RATER_ROLES: ReadonlySet<string> = new Set(["owner", "admin", "editor"]);

export type CanRateInput = {
  status: TicketStatus | string;
  role: OrgRole | string;
  /** True when the person filed this ticket. */
  isFiler: boolean;
  /** True under CDS staff impersonation (ratings are the owner's voice, never staff's). */
  impersonated: boolean;
};

/**
 * True only on a Resolved ticket, never under impersonation, for Owner/Admin/Editor or the
 * filer. Closed means ratings are finished.
 */
export function canRate(input: CanRateInput): boolean {
  if (input.status !== "resolved") return false;
  if (input.impersonated) return false;
  return RATER_ROLES.has(input.role) || input.isFiler === true;
}

/** Thumbs-up share as a rounded percentage, or null when nothing was rated. */
export function ratingRate(up: number, down: number): number | null {
  const u = Number.isFinite(up) && up > 0 ? up : 0;
  const d = Number.isFinite(down) && down > 0 ? down : 0;
  const total = u + d;
  if (total === 0) return null;
  return Math.round((u / total) * 100);
}

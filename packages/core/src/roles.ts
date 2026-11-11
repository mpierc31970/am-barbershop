// Role and action vocabulary (TEN-06, TEN-11, TEN-14; D9, D285). Pure and Edge-safe.
//
// Two populations (Invariant 10): org roles live on `memberships.role`; staff roles live on
// `users.staff_role` and never grant tenant access directly (staff reach a tenant only by
// audited impersonation, D98).

/** Roles a member can hold inside one organization (D9, D285). */
export const ORG_ROLES = [
  "owner",
  "admin",
  "editor",
  "viewer",
  "staff",
  "renter",
] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** CDS staff roles (TEN-11). An empty `staff_role` means "not staff". */
export const STAFF_ROLES = ["super_admin", "support_agent"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** What a subject does to a feature: view it, change it, or run a one-shot operation. */
export type Action = "read" | "write" | "run";

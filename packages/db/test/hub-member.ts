// 13-26: test-only helpers for apps/web hub tests (impersonation): a member with a known
// password in one org, and an audit-row count. Keeps the superuser client inside packages/db
// (Invariant 1).
import { randomBytes } from "node:crypto";
import { superuser } from "../src/client";

/** A fresh member of `orgId` with `role` and a known password. */
export async function createTestMember(
  orgId: string,
  role: "owner" | "admin" | "editor" | "viewer" = "owner",
): Promise<{ email: string; password: string; userId: string }> {
  const email = `member-${randomBytes(4).toString("hex")}@example.test`;
  const password = `pw-${randomBytes(8).toString("hex")}`;
  const pb = await superuser();
  const user = await pb
    .collection("users")
    .create({ email, password, passwordConfirm: password });
  await pb
    .collection("memberships")
    .create({ user: user.id, organization: orgId, role });
  return { email, password, userId: user.id };
}

/** audit_log rows for one org, optionally one action (bound params only). */
export async function auditRowsFor(
  orgId: string,
  action?: string,
): Promise<{ id: string; action: string; actor: string; meta: unknown }[]> {
  const pb = await superuser();
  const filter = action
    ? pb.filter("organization = {:o} && action = {:a}", { o: orgId, a: action })
    : pb.filter("organization = {:o}", { o: orgId });
  const rows = await pb.collection("audit_log").getFullList({ filter });
  return rows.map((r) => ({
    id: r.id,
    action: String(r.action),
    actor: String(r.actor ?? ""),
    meta: r.meta,
  }));
}

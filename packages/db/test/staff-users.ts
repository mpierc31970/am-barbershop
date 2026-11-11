// 13-21: a test-only staff (or member) user with a known password, for apps/web tests that run
// the real sign-in actions (apps/web/test/staff-test-kit.ts signInStaffForTest). Keeps the
// superuser client inside packages/db (Invariant 1).
import { randomBytes } from "node:crypto";
import { superuser } from "../src/client";

/** The sign-in limiter reset, for apps/web tests (rate-limit is not on the public entry). */
export { resetSignInLimitsForTests } from "../src/rate-limit";

export async function createTestStaffUser(
  role: "super_admin" | "support_agent" | "",
  email?: string,
): Promise<{ email: string; password: string; userId: string }> {
  const address =
    email ??
    `staff-${role || "member"}-${randomBytes(4).toString("hex")}@example.test`;
  const password = `pw-${randomBytes(8).toString("hex")}`;
  const pb = await superuser();
  const user = await pb.collection("users").create({
    email: address,
    password,
    passwordConfirm: password,
    staff_role: role,
    name: role === "super_admin" ? "Sam Admin" : "Mara Agent",
  });
  return { email: address, password, userId: user.id };
}

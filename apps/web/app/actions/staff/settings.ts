"use server";
// Settings actions (13-46 choice 2; STAFF-18, STAFF-16; T-13-46-01, T-13-46-03). Public POST
// endpoints (Server Actions, never a GET): every argument is untrusted. Thin callers of the
// @cds/db functions the CLIs already use:
//   changeStaffRoleAction(userId, role | "none") -> setStaffRole (audit staff_role.change)
//   resetDemoAction()                            -> staffResetDemo (audit demo.reset)
// Both are super_admin only and need a fresh step-up. setStaffRole rotates the person's
// tokenKey in the same update, so the change takes effect on their next click, and it refuses
// to demote the last super_admin (the caller included). The console also refuses a change to
// your own role (UI-SPEC "You can't change your own role."). Errors are logged by class name.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { InvalidInput } from "@cds/core";
import {
  DEMO_NAME,
  setStaffRole,
  staffListStaff,
  staffResetDemo,
  type PlatformContext,
} from "@cds/db";
import { revalidatePath } from "next/cache";
import { nextInvalidator } from "../../../lib/invalidator";
import { SECTION_REGISTRY } from "../../../lib/section-registry";
import {
  errorName,
  runStaffAction,
  type ActionResult,
} from "../../../lib/staff-action";

type Failure = Extract<ActionResult<never>, { ok: false }>;

const ID_RE = /^[a-z0-9]{15}$/;
const ROLE_CHOICES = ["super_admin", "support_agent", "none"] as const;
type RoleChoice = (typeof ROLE_CHOICES)[number];

const ROLE_WORDS: Readonly<Record<RoleChoice, string>> = {
  super_admin: "a Super Admin",
  support_agent: "a Support agent",
  none: "",
};

const OWN_ROLE_COPY = "You can't change your own role.";
const LAST_SUPER_COPY =
  "The platform must keep one Super Admin. Make someone else a Super Admin first.";

const NOT_FOUND: Failure = {
  ok: false,
  code: "not_found",
  message: "That staff member wasn't found.",
};

function refresh(path: string): void {
  try {
    revalidatePath(path);
  } catch (err) {
    console.error("[staff settings] revalidate failed", errorName(err));
  }
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "They";
}

/** Change one staff member's role (Settings › Staff). "none" removes the staff role. */
export async function changeStaffRoleAction(
  userId: unknown,
  role: unknown,
): Promise<ActionResult<{ message: string }>> {
  const id = typeof userId === "string" && ID_RE.test(userId) ? userId : null;
  if (!id) return NOT_FOUND;
  const choice = (ROLE_CHOICES as readonly unknown[]).includes(role)
    ? (role as RoleChoice)
    : null;
  if (!choice) {
    return {
      ok: false,
      code: "invalid_input",
      message: "Pick Super Admin or Support agent.",
      field: "role",
    };
  }
  const result = await runStaffAction(
    "staff_roles",
    { stepUp: true },
    async (ctx: PlatformContext) => {
      if (ctx.actor === id) throw new InvalidInput(OWN_ROLE_COPY);
      const person = (await staffListStaff(ctx)).find((r) => r.id === id);
      if (!person) return null;
      try {
        await setStaffRole(ctx, id, choice === "none" ? "" : choice);
      } catch (err) {
        if (
          err instanceof InvalidInput &&
          err.message.includes("one super_admin")
        ) {
          throw new InvalidInput(LAST_SUPER_COPY);
        }
        throw err;
      }
      const who = firstName(person.name);
      return {
        message:
          choice === "none"
            ? `${who} no longer has a staff role.`
            : `${who} is now ${ROLE_WORDS[choice]}.`,
      };
    },
  );
  if (result.ok && result.data === null) return NOT_FOUND;
  if (result.ok) refresh("/staff/settings");
  return result as ActionResult<{ message: string }>;
}

/** Reset Bella's Salon now (Settings › Demo tenant). Bypasses the 3 am hour, not the step-up. */
export async function resetDemoAction(): Promise<
  ActionResult<{ message: string; rowsSeeded: number; rowsDeleted: number }>
> {
  const result = await runStaffAction(
    "demo_reset",
    { stepUp: true },
    async (ctx: PlatformContext) => {
      const out = await staffResetDemo(ctx, {
        addons: ADDON_REGISTRY,
        sections: SECTION_REGISTRY,
        invalidator: nextInvalidator,
      });
      return {
        message: `Reset ${DEMO_NAME}. ${out.rowsSeeded} rows replaced. No other site changed.`,
        rowsSeeded: out.rowsSeeded,
        rowsDeleted: out.rowsDeleted,
      };
    },
  );
  if (result.ok) refresh("/staff/settings");
  return result;
}

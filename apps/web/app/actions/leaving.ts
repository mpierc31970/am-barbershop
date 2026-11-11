"use server";
// Leaving CDS actions (14-42 choice 6; LIFE-01, D282, D284; 14-UI-SPEC "Leaving CDS (owner)";
// T-14-42-01, T-14-42-02). Public POST endpoints (Next server actions): every argument is
// untrusted and narrowed here first; the org and the person come only from the session
// (runAction), never the browser. Each calls the 14-39 / 14-40 @cds/db function, which checks
// `offboarding:run` (Owner) and refuses staff impersonating through IMPERSONATION_DENY; those
// refusals map to the owner-only and IMPERSONATING-LEAVE copy here.
//   - requestLeaveCodeAction / startLeavingAction: the emailed-code step-up. A refused code
//     (wrong, used or expired: PocketBase answers all three the same way) maps to CODE-WRONG
//     (ERR_CODE, which says to request a new one); a missing code is the chokepoint's
//     "Enter the code we emailed you.".
//   - chooseDestinationAction / checkNewDnsAction / confirmSwitchedAction: the handback steps
//     (RateLimited keeps code rate_limited; the flow shows "Wait a minute, then check again.").
//   - downloadZoneFileAction: the zone file text (handbackZoneFile, org-scoped) for a client
//     Blob download (14-42 choice 4: a POST action, not a GET route, because the export also
//     stores a copy).
//   - downloadLeavingDataAction / completeLeavingStepAction: the later steps (DNS first is
//     enforced by @cds/db: "Move your DNS first.").
//   - stayWithCdsAction: cancel the notice (Stay with CDS).
import "@cds/addon-registry/server";
import { can, Forbidden } from "@cds/core";
import { P14_COPY } from "@cds/core/dns";
import {
  ERR_CODE,
  cancelOffboarding,
  checkHandbackDestination,
  chooseHandbackDestination,
  completeOffboardingStep,
  confirmHandbackSwitched,
  handbackZoneFile,
  requestOffboardingCode,
  requestOffboardingDownload,
  startOffboarding,
  type OffboardingReasonCategory,
} from "@cds/db";
import { LEAVE_REASONS, type HandbackZoneUi } from "@cds/ui/hub/leaving";
import { revalidatePath } from "next/cache";
import { toHandbackUi } from "../(platform)/hub/leaving/leaving-view";
import { runAction, type ActionResult } from "../../lib/action";

const COPY = {
  forbidden: "Only the owner can do this.",
  impersonation: P14_COPY.IMPERSONATING_LEAVE,
};

const BAD_INPUT = "That didn't look right. Reload the page and try again.";
const NOTE_MAX = 1000;
const OTP_ID = /^[a-z0-9]{15}$/;
const CODE = /^\d{6}$/;
const DOMAIN =
  /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const NS_MAX = 253;
const TICK_STEPS = ["addons", "services", "billing"] as const;

function bad(): ActionResult<never> {
  return { ok: false, code: "invalid_input", message: BAD_INPUT };
}

function own(input: unknown, key: string): unknown {
  if (typeof input !== "object" || input === null) return undefined;
  return Object.hasOwn(input, key)
    ? (input as Record<string, unknown>)[key]
    : undefined;
}

function domainOf(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const d = raw.trim().toLowerCase();
  return DOMAIN.test(d) ? d : null;
}

function revalidate(): void {
  for (const path of ["/hub/leaving", "/hub"]) {
    try {
      revalidatePath(path, path === "/hub" ? "layout" : "page");
    } catch (err) {
      console.error(
        "[leaving] revalidate failed",
        err instanceof Error ? err.name : typeof err,
      );
    }
  }
}

/** Step 1 of Start the 30-day notice: email the owner a code. */
export async function requestLeaveCodeAction(): Promise<
  ActionResult<{ otpId: string; maskedEmail: string }>
> {
  return runAction(({ ctx }) => requestOffboardingCode(ctx), COPY);
}

/** Start the 30-day notice with the emailed code (+ optional reason and note). */
export async function startLeavingAction(
  input: unknown,
): Promise<ActionResult<null>> {
  const rawCategory = own(input, "reasonCategory");
  const note = own(input, "note");
  const otpId = own(input, "otpId");
  const code = own(input, "code");
  if (
    typeof rawCategory !== "string" ||
    (rawCategory !== "" &&
      !LEAVE_REASONS.some((r) => r.value === rawCategory)) ||
    typeof note !== "string" ||
    note.length > NOTE_MAX ||
    typeof otpId !== "string" ||
    !OTP_ID.test(otpId) ||
    typeof code !== "string" ||
    !CODE.test(code)
  ) {
    return bad();
  }
  let wrongCode = false;
  const res = await runAction(async ({ ctx }) => {
    const owner = can(ctx, "offboarding", "run") && !ctx.impersonator;
    try {
      await startOffboarding(ctx, undefined, {
        reasonCategory: rawCategory as OffboardingReasonCategory | "",
        note,
        code: { otpId, code },
      });
    } catch (err) {
      // Role and impersonation were checked before the code: here Forbidden is the code.
      if (owner && err instanceof Forbidden) wrongCode = true;
      throw err;
    }
    return null;
  }, COPY);
  if (wrongCode) return { ok: false, code: "code_wrong", message: ERR_CODE };
  if (res.ok) revalidate();
  return res;
}

/** "Where should your DNS go?" (runs the reverse gate at once). */
export async function chooseDestinationAction(
  domain: unknown,
  input: unknown,
): Promise<ActionResult<HandbackZoneUi>> {
  const d = domainOf(domain);
  const kind = own(input, "kind");
  if (!d || (kind !== "registrar" && kind !== "other")) return bad();
  let nameservers: [string, string] | undefined;
  if (kind === "other") {
    const raw = own(input, "nameservers");
    if (
      !Array.isArray(raw) ||
      raw.length !== 2 ||
      raw.some((n) => typeof n !== "string" || n.length > NS_MAX)
    ) {
      return bad();
    }
    nameservers = [String(raw[0]), String(raw[1])];
  }
  const res = await runAction(
    async ({ ctx }) =>
      toHandbackUi(
        await chooseHandbackDestination(
          ctx,
          undefined,
          d,
          nameservers ? { kind, nameservers } : { kind },
        ),
      ),
    COPY,
  );
  if (res.ok) revalidate();
  return res;
}

/** "Check my new DNS". */
export async function checkNewDnsAction(
  domain: unknown,
): Promise<ActionResult<HandbackZoneUi>> {
  const d = domainOf(domain);
  if (!d) return bad();
  const res = await runAction(
    async ({ ctx }) =>
      toHandbackUi(await checkHandbackDestination(ctx, undefined, d)),
    COPY,
  );
  if (res.ok) revalidate();
  return res;
}

/** "I've changed them". */
export async function confirmSwitchedAction(
  domain: unknown,
): Promise<ActionResult<HandbackZoneUi>> {
  const d = domainOf(domain);
  if (!d) return bad();
  const res = await runAction(
    async ({ ctx }) =>
      toHandbackUi(await confirmHandbackSwitched(ctx, undefined, d)),
    COPY,
  );
  if (res.ok) revalidate();
  return res;
}

/** Download zone file: the text for a client-side file save. */
export async function downloadZoneFileAction(
  domain: unknown,
): Promise<ActionResult<{ filename: string; text: string }>> {
  const d = domainOf(domain);
  if (!d) return bad();
  return runAction(({ ctx }) => handbackZoneFile(ctx, undefined, d), COPY);
}

/** Step 2: Download your data (the D284 zip, which includes dns/zone.txt). */
export async function downloadLeavingDataAction(): Promise<ActionResult<null>> {
  const res = await runAction(async ({ ctx }) => {
    await requestOffboardingDownload(ctx);
    return null;
  }, COPY);
  if (res.ok) revalidate();
  return res;
}

/** Steps 3-5: the owner marks Add-ons, Connected services or Billing as done. */
export async function completeLeavingStepAction(
  step: unknown,
): Promise<ActionResult<null>> {
  if (
    typeof step !== "string" ||
    !(TICK_STEPS as readonly string[]).includes(step)
  ) {
    return bad();
  }
  const res = await runAction(async ({ ctx }) => {
    await completeOffboardingStep(
      ctx,
      undefined,
      step as (typeof TICK_STEPS)[number],
    );
    return null;
  }, COPY);
  if (res.ok) revalidate();
  return res;
}

/** Stay with CDS: the notice is cancelled and everything carries on. */
export async function stayWithCdsAction(): Promise<
  ActionResult<{ message: string }>
> {
  const res = await runAction(async ({ ctx }) => {
    const out = await cancelOffboarding(ctx, undefined);
    return { message: out.message };
  }, COPY);
  if (res.ok) revalidate();
  return res;
}

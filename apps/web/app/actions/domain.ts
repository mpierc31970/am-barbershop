"use server";
// Settings › Domain actions (14-31 choice 5; DOM-02, DOM-03, DOM-04, DOM-05; 14-UI-SPEC
// "Settings › Domain"; P14-P12, P14-P15, P14-P16, P14-P34; T-14-31-01, T-14-31-02,
// T-14-31-04). Public POST endpoints (Next server actions: POST, origin-checked): every
// argument is untrusted. The org comes only from the session (runAction); nothing takes an
// org, move or record id. Input is narrowed here first (domain <= 253, note <= 500, zone file a
// FormData File <= 256 KiB read as text, ack keys ^G5:[a-z_]+$, choice apex|www), then the
// 14-29 / 14-28 owner function runs, which checks `domain:write` (Owner, or staff while
// impersonating, audited) and `dnsOpen()` itself, so the feature stays dark in production
// even if the UI were bypassed. An Admin is refused with DOMAIN-ADMIN-READ. A refused owner
// step (`OwnerDomainRefused`) answers with its P14_COPY message and a UI code
// ("DOM-TAKEN", "ZONE-TOO-BIG", …) so the form can offer Ask CDS Support.
import { P14_COPY } from "@cds/core/dns";
import {
  OwnerDomainRefused,
  ownerAcknowledge,
  ownerCheckNameservers,
  ownerConnectDomain,
  ownerDomainView,
  ownerSendNameserverSteps,
  ownerSetPrimaryChoice,
  ownerUploadZoneFile,
  ownerUseDifferentDomain,
  type OwnerDomainState,
} from "@cds/db";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "../../lib/action";
import { domainMark } from "../(platform)/hub/settings/domain-view";

const DOMAIN_MAX = 253;
const EMAIL_MAX = 254;
const NOTE_MAX = 500;
/** Zone files: 256 KiB, checked on the File size before reading (T-14-31-02). */
const ZONE_MAX_BYTES = 256 * 1024;
const ACK_KEY = /^G5:[a-z_]+$/;

const COPY = {
  forbidden: P14_COPY.DOM_ADMIN_READ,
  // Staff may act on the domain while impersonating (P14-P12): never denied, but the
  // override keeps the words right if a deny is ever added.
  impersonation: P14_COPY.DOM_ADMIN_READ,
};

const BAD_INPUT = "That didn't look right. Reload the page and try again.";

function bad(message: string, field?: string): ActionResult<never> {
  return {
    ok: false,
    code: "invalid_input",
    message,
    ...(field ? { field } : {}),
  };
}

/** The UI code for a refused owner step ("taken" -> "DOM-TAKEN", "zone_too_big" -> "ZONE-TOO-BIG"). */
function refusalCode(reason: string): string {
  const upper = reason.toUpperCase().replace(/_/g, "-");
  return upper.startsWith("ZONE-") ? upper : `DOM-${upper}`;
}

type Refused = { refused: { code: string; message: string } };

async function step<T>(fn: () => Promise<T>): Promise<{ value: T } | Refused> {
  try {
    return { value: await fn() };
  } catch (err) {
    if (err instanceof OwnerDomainRefused) {
      return {
        refused: { code: refusalCode(err.reason), message: err.message },
      };
    }
    throw err;
  }
}

function revalidate(): void {
  try {
    revalidatePath("/hub/settings");
  } catch (err) {
    console.error(
      "[domain] revalidate failed",
      err instanceof Error ? err.name : "unknown",
    );
  }
}

/** Run an owner domain step; unwraps refusals into `{ ok: false, code, message }`. */
async function run<T>(
  fn: (ctx: Parameters<typeof ownerDomainView>[0]) => Promise<T>,
  field?: string,
): Promise<ActionResult<T>> {
  const res = await runAction((s) => step(() => fn(s.ctx)), COPY);
  if (!res.ok) return res;
  if ("refused" in res.data) {
    return {
      ok: false,
      code: res.data.refused.code,
      message: res.data.refused.message,
      ...(field ? { field } : {}),
    };
  }
  revalidate();
  return { ok: true, data: res.data.value };
}

function narrowDomain(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (v.length === 0 || v.length > DOMAIN_MAX + 16) return null;
  return v;
}

/** S0 "Check my domain". */
export async function connectDomainAction(
  domain: unknown,
): Promise<ActionResult<{ state: OwnerDomainState }>> {
  const raw = narrowDomain(domain);
  if (!raw) return bad(P14_COPY.DOM_INVALID, "domain");
  return run(async (ctx) => {
    const view = await ownerConnectDomain(ctx, raw);
    return { state: view.state };
  }, "domain");
}

/** S2 zone file: FormData `file`, <= 256 KiB, read as text only. */
export async function uploadZoneFileAction(
  form: unknown,
): Promise<ActionResult<{ added: number; message: string }>> {
  if (!(form instanceof FormData)) return bad(P14_COPY.ZONE_UNREADABLE);
  const file = form.get("file");
  if (!(file instanceof File)) return bad(P14_COPY.ZONE_UNREADABLE);
  if (file.size > ZONE_MAX_BYTES) {
    return { ok: false, code: "ZONE-TOO-BIG", message: P14_COPY.ZONE_TOO_BIG };
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    return {
      ok: false,
      code: "ZONE-UNREADABLE",
      message: P14_COPY.ZONE_UNREADABLE,
    };
  }
  return run(async (ctx) => {
    const r = await ownerUploadZoneFile(ctx, text);
    return { added: r.added, message: r.message };
  });
}

/** S2 G5 checkbox ("I understand my email forwarding stops"). */
export async function acknowledgeFindingAction(
  key: unknown,
): Promise<ActionResult<{ state: OwnerDomainState }>> {
  if (typeof key !== "string" || key.length > 40 || !ACK_KEY.test(key)) {
    return bad(BAD_INPUT);
  }
  return run(async (ctx) => {
    const view = await ownerAcknowledge(ctx, key);
    return { state: view.state };
  });
}

/**
 * "I've changed them", "Check again", "Check now", "I've switched them back" (P14-P15: the
 * step runs now, 1 per 30 s per org in @cds/db). `notYet` -> NS-NOT-YET.
 */
export async function checkNameserversAction(): Promise<
  ActionResult<{ state: OwnerDomainState; notYet: boolean }>
> {
  return run(async (ctx) => {
    const r = await ownerCheckNameservers(ctx);
    return { state: r.state, notYet: r.notYet };
  });
}

/** S3 "Send these steps to someone" (5 per day, D173 sender in @cds/db). */
export async function sendStepsAction(
  input: unknown,
): Promise<ActionResult<{ sent: true }>> {
  const o = (input ?? {}) as { email?: unknown; note?: unknown };
  const email = typeof o.email === "string" ? o.email.trim().toLowerCase() : "";
  if (email.length === 0 || email.length > EMAIL_MAX) {
    return bad("Enter an email address like name@example.com.", "email");
  }
  const note = typeof o.note === "string" ? o.note.trim() : "";
  if (note.length > NOTE_MAX) {
    return bad("Keep the note under 500 characters.", "note");
  }
  return run(
    (ctx) =>
      ownerSendNameserverSteps(ctx, { to: email, ...(note ? { note } : {}) }),
    "email",
  );
}

/** S1 / S2 "Use a different domain" (before the nameserver step only). */
export async function useDifferentDomainAction(): Promise<
  ActionResult<{ state: OwnerDomainState }>
> {
  return run(async (ctx) => {
    const view = await ownerUseDifferentDomain(ctx);
    return { state: view.state };
  });
}

/** S5 / S6 "Your main address" (P14-P16). */
export async function setPrimaryChoiceAction(
  choice: unknown,
): Promise<ActionResult<{ choice: "apex" | "www"; swapped: boolean }>> {
  if (choice !== "apex" && choice !== "www") return bad(BAD_INPUT);
  return run(async (ctx) => {
    const r = await ownerSetPrimaryChoice(ctx, choice);
    return { choice: r.choice, swapped: r.swapped };
  });
}

/**
 * The status poller's read (S1 / S4, every 5 s while visible): the state and a short
 * fingerprint so the island refreshes only on a change. No revalidation.
 */
export async function domainStatusAction(): Promise<
  ActionResult<{ state: OwnerDomainState; mark: string }>
> {
  const res = await runAction(async (s) => {
    const view = await ownerDomainView(s.ctx);
    const mark = domainMark(view);
    return { state: view.state, mark };
  }, COPY);
  return res;
}

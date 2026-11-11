"use server";
// Sign the agreement (09-17; AGR-02, AGR-03, AGR-07; CONTEXT A2-Q1, A2-Q2, A3-Q1; RESEARCH
// Pitfall 12; T-09-17-01, -02, -03, -06). A public POST endpoint: every posted value is
// untrusted. The org, the signer and the role come only from the session cookie (runAction);
// the shape is checked here, then signAgreement compares the posted versions and hashes with
// the active set (09-10). The IP is the trusted-hop one from the session helper, never a posted or
// re-parsed header. Logs carry codes only, never the typed name, the email or the IP.
// On success the form navigates itself (09-17 choice 1), so no redirect runs inside runAction.
import { InvalidInput } from "@cds/core";
import { signAgreement, type PostedPolicy } from "@cds/db";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { runAction, type ActionResult } from "../../lib/action";
import { safeNext } from "../../lib/agreement-gate";
import * as hubSession from "../../lib/session";

const SIGN_COPY = {
  forbidden: "Only the site owner can sign this agreement.",
  impersonation:
    "You're viewing as support staff, so signing is turned off. Only the owner can sign.",
};
const ERR_SIGN =
  "We couldn't record your signature, so nothing was signed. Try again in a minute. If it keeps happening, contact Support.";
const BAD_REQUEST =
  "That signing request doesn't look right. Reload the page and try again.";
const NAME_TOO_LONG = "Type your full name, up to 120 characters.";

const MAX_POLICIES = 10;
const MAX_UA = 512;
const MAX_NAME = 120;
const SHA_RE = /^[0-9a-f]{64}$/;
const KEY_RE = /^[a-z][a-z0-9-]{0,63}$/;

export type SignPayload = {
  policies: { key: string; version: number; sha256: string }[];
  consent: { version: number; sha256: string };
  signerName: string;
  next?: string;
};

type Clean = {
  policies: PostedPolicy[];
  consent: { version: number; sha256: string };
  signerName: string;
  next: string;
};

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function version(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 9999) {
    throw new InvalidInput(BAD_REQUEST);
  }
  return v;
}

function sha(v: unknown): string {
  if (typeof v !== "string" || !SHA_RE.test(v)) {
    throw new InvalidInput(BAD_REQUEST);
  }
  return v;
}

/** Shape check only; the chokepoint checks the values against the active set. */
function clean(raw: unknown): Clean {
  if (!isObj(raw)) throw new InvalidInput(BAD_REQUEST);
  const { policies, consent, signerName, next } = raw;
  if (
    !Array.isArray(policies) ||
    policies.length < 1 ||
    policies.length > MAX_POLICIES
  ) {
    throw new InvalidInput(BAD_REQUEST);
  }
  const posted = policies.map((p): PostedPolicy => {
    if (!isObj(p) || typeof p.key !== "string" || !KEY_RE.test(p.key)) {
      throw new InvalidInput(BAD_REQUEST);
    }
    // Allow-listed keys only: anything else on the object is dropped.
    return { key: p.key, version: version(p.version), sha256: sha(p.sha256) };
  });
  if (!isObj(consent)) throw new InvalidInput(BAD_REQUEST);
  if (typeof signerName !== "string") throw new InvalidInput(BAD_REQUEST);
  if ([...signerName.trim()].length > MAX_NAME) {
    throw new InvalidInput(NAME_TOO_LONG);
  }
  if (next !== undefined && next !== null && typeof next !== "string") {
    throw new InvalidInput(BAD_REQUEST);
  }
  return {
    policies: posted,
    consent: { version: version(consent.version), sha256: sha(consent.sha256) },
    signerName,
    next: safeNext(typeof next === "string" ? next : null),
  };
}

function refreshHub(): void {
  try {
    revalidatePath("/hub", "layout");
  } catch (err) {
    console.error(
      "[agreement] revalidate failed",
      err instanceof Error ? err.name : typeof err,
    );
  }
}

/** Owner signs the shown policies and the consent once (D216, D287). */
export async function signAgreementAction(
  payload: SignPayload,
): Promise<ActionResult<{ signatureId: string; next: string }>> {
  const res = await runAction(async (s) => {
    const input = clean(payload);
    const userAgent = ((await headers()).get("user-agent") ?? "").slice(
      0,
      MAX_UA,
    );
    const result = await signAgreement(s.ctx, {
      policies: input.policies,
      consent: input.consent,
      signerName: input.signerName,
      ip: await hubSession.clientIp(),
      userAgent,
      authMethod: await hubSession.readAuthMethod(),
    });
    return { signatureId: result.signatureId, next: input.next };
  }, SIGN_COPY);
  if (res.ok) {
    refreshHub();
    return res;
  }
  if (res.code === "save_failed") {
    return { ok: false, code: res.code, message: ERR_SIGN };
  }
  return res;
}

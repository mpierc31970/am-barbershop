"use server";
// Settings › Email "Sending from your domain" action (14-25 choice 5; ONB-10, D112, D173;
// P14-P20; T-14-25-02, T-14-25-03). A public POST endpoint: the argument is untrusted. The org
// and role come only from the session (runAction); the local part is narrowed here to the send
// path's own rule (isSendingLocalPart) and again in @cds/db. Owner only: an Admin or Editor is
// refused before any write, and setSendingLocalPart checks `domain:write` again. Staff
// impersonating may act (P14-P12); the chokepoint audits it.
import { P14_COPY } from "@cds/core/dns";
import { isSendingLocalPart } from "@cds/core/email";
import { setSendingLocalPart } from "@cds/db";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "../../lib/action";

const LOCAL_MAX = 64;
const OWNER_ONLY_COPY = "Only the Owner can change the sending address.";

export async function saveSendingLocalPartAction(
  localPart: unknown,
): Promise<ActionResult<{ localPart: string }>> {
  const raw =
    typeof localPart === "string" && localPart.length <= LOCAL_MAX + 8
      ? localPart.trim().toLowerCase()
      : "";
  if (!isSendingLocalPart(raw) || raw.length > LOCAL_MAX) {
    return {
      ok: false,
      code: "invalid_input",
      message: P14_COPY.SEND_LOCAL_INVALID,
      field: "localPart",
    };
  }
  const res = await runAction(
    async (s) => {
      if (s.ctx.role !== "owner") {
        return { refused: true as const };
      }
      const view = await setSendingLocalPart(s.ctx, raw);
      return { refused: false as const, localPart: view.localPart };
    },
    { forbidden: OWNER_ONLY_COPY },
  );
  if (!res.ok) {
    return res.code === "invalid_input" ? { ...res, field: "localPart" } : res;
  }
  if (res.data.refused) {
    return { ok: false, code: "forbidden", message: OWNER_ONLY_COPY };
  }
  try {
    revalidatePath("/hub/settings");
  } catch (err) {
    console.error(
      "[sending] revalidate failed",
      err instanceof Error ? err.name : "unknown",
    );
  }
  return { ok: true, data: { localPart: res.data.localPart } };
}

// Sign out from this browser (review 11 WR-A02, WR-E01; D305). Client-side: before the
// session goes, unsubscribe this browser's hub push and hand the old endpoint to the server
// action, which drops the signed-out person's row for it in every org. On a shared or
// front-desk computer the next person then never sees the previous member's alerts.
// forgetThisBrowser never throws and waits at most 3 s, so sign-out always goes ahead.
import { forgetThisBrowser } from "@cds/ui/hub/today";
import { signOutAction } from "../app/actions/session";
import { signOutForInviteAction } from "../app/actions/invite";

export async function signOutThisBrowser(): Promise<void> {
  const endpoint = await forgetThisBrowser();
  await signOutAction(endpoint ?? undefined);
}

/** The invite page's "wrong account" sign-out: same, then back to the invite. */
export async function signOutForInviteThisBrowser(
  formData: FormData,
): Promise<void> {
  const endpoint = await forgetThisBrowser();
  if (endpoint) formData.set("endpoint", endpoint);
  await signOutForInviteAction(formData);
}

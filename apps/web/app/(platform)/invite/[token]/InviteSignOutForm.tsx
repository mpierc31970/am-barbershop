"use client";
// The invite page's wrong-account Sign out (11-38; review 11 WR-E01). A client island so
// the browser can unsubscribe its hub push and send the old endpoint along: the signed-out
// person's alerts then stop reaching this browser. Without JS the plain form still signs out.
import { Button } from "@cds/ui/hub";
import { signOutForInviteThisBrowser } from "../../../../lib/sign-out-browser";

export function InviteSignOutForm({ token }: { token: string }) {
  return (
    <form action={signOutForInviteThisBrowser}>
      <input type="hidden" name="token" value={token} />
      <Button type="submit" variant="secondary" className="w-full">
        Sign out
      </Button>
    </form>
  );
}

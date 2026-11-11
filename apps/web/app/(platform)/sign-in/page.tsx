// /sign-in (CONT-08, CONTEXT A2-Q2): the shop owner and barbers. A&M fork: served on the
// site's own host (SITE_ADMIN_HOST) in the site's look (AmSignInFrame). A member who is already signed in goes straight to the hub.
// Tenant hosts never reach this route: the middleware rewrites them to /tenant/<host>.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getHubSession } from "../../../lib/session";
import { safeSignInNext } from "../../../lib/sign-in-next";
import { AmSignInFrame } from "./AmSignInFrame";
import { SignInForm } from "./SignInForm";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * `?next=/invite/<token>` (review 11 WR-E02): after sign-in, go back to that invite (only an
 * invite path is honoured). `?method=code` opens the emailed-code form straight away.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp: SearchParams = (await searchParams) ?? {};
  const next = safeSignInNext(sp.next);
  if (await getHubSession()) redirect(next ?? "/hub/website");
  return (
    <AmSignInFrame title="Sign in">
      <SignInForm
        next={next ?? undefined}
        startWithCode={sp.method === "code"}
      />
    </AmSignInFrame>
  );
}

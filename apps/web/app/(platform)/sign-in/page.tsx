// /sign-in on the platform host (CONT-08, CONTEXT A2-Q2; UI-SPEC "Sign-in"). Centered 400px
// card on hub-surface-2. A member who is already signed in goes straight to the hub.
// Tenant hosts never reach this route: the middleware rewrites them to /tenant/<host>.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getHubSession } from "../../../lib/session";
import { safeSignInNext } from "../../../lib/sign-in-next";
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
    <main className="flex min-h-dvh items-start justify-center bg-hub-surface-2 px-4 py-12 font-hub text-hub-ink sm:items-center">
      <div className="w-full max-w-[400px] rounded-lg border border-hub-border bg-hub-surface p-6">
        <h1 className="mb-6 text-[1.75rem] leading-tight font-semibold">
          Sign in to your site
        </h1>
        <SignInForm
          next={next ?? undefined}
          startWithCode={sp.method === "code"}
        />
      </div>
    </main>
  );
}

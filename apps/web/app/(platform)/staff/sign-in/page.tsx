// /staff/sign-in on the platform host (13-25 choice 2; STAFF-06, Invariant 10; 13-UI-SPEC
// lines 244-259). The P3 sign-in frame (centred 400px card on hub-surface-2) in the CDS identity
// layer: CdsMark 32 + "Staff sign-in", a line pointing site owners to /sign-in, then the two-step
// form. A signed-in staff member goes straight to a safe `next` (safeStaffNext, /staff/** only;
// T-13-25-03) or /staff. noindex here, plus X-Robots-Tag and robots.txt for /staff (P13-P33).
// Tenant hosts never reach this route: the middleware rewrites them to /tenant/<host>.
import { CdsMark } from "@cds/ui/hub/cds";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getStaffSession } from "../../../../lib/staff-session";
import { safeStaffNext } from "../../../../lib/staff-next";
import { StaffSignInForm } from "./StaffSignInForm";

export const metadata: Metadata = {
  title: "Staff sign-in",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

const LINK =
  "rounded text-hub-accent underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

export default async function StaffSignInPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp: SearchParams = (await searchParams) ?? {};
  const next = safeStaffNext(Array.isArray(sp.next) ? sp.next[0] : sp.next);
  if (await getStaffSession()) redirect(next ?? "/staff");
  return (
    <main
      data-cds-identity=""
      className="flex min-h-dvh items-start justify-center bg-hub-surface-2 px-4 py-12 font-hub text-hub-ink sm:items-center"
    >
      <div className="w-full max-w-[400px] rounded-lg border border-hub-border bg-hub-surface p-6">
        <div className="mb-2 flex items-center gap-3">
          <CdsMark size={32} />
          <h1 className="text-[1.75rem] leading-tight font-semibold">
            Staff sign-in
          </h1>
        </div>
        <p className="mb-6 text-sm text-hub-ink-muted">
          For CDS staff. Site owners sign in at{" "}
          <a href="/sign-in" className={LINK}>
            /sign-in
          </a>
          .
        </p>
        <StaffSignInForm next={next ?? undefined} ended={sp.ended === "1"} />
      </div>
    </main>
  );
}

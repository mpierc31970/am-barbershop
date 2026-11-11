// /test-pay/*: the fake payment adapter's stand-in pages (10-23; CONTEXT A1, UI-SPEC "Test
// pages", D-UI-P10-8, Pitfall 4). Full-bleed hub-surface-2 under the 40px TestModeStrip, a
// centred 480px panel (P3 sign-in pattern) and the wordmark "CDS test payments" (never the
// CDS brand wordmark, so a test page can't be mistaken for a real one). Robots: noindex.
// 404 when CDS_ENV=production: the stand-in pages do not exist there (choice 3, with the fake
// helpers' own PaymentsUnavailable refusal as the second guard).
import { TestModeStrip } from "@cds/ui/hub/billing";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { TEST_PAY_WORDMARK } from "../../../lib/test-pay";

export const metadata: Metadata = {
  title: "Test payment",
  robots: "noindex, nofollow",
};

export const dynamic = "force-dynamic";

export default function TestPayLayout({ children }: { children: ReactNode }) {
  if (process.env.CDS_ENV === "production") notFound();
  return (
    <div className="flex min-h-dvh flex-col bg-hub-surface-2 font-hub text-hub-ink">
      <TestModeStrip />
      <main className="flex flex-1 items-start justify-center px-4 py-12 sm:items-center">
        <div className="flex w-full max-w-[480px] flex-col gap-6 rounded-lg border border-hub-border bg-hub-surface p-6">
          <p className="text-base font-semibold text-hub-ink">
            {TEST_PAY_WORDMARK}
          </p>
          {children}
        </div>
      </main>
    </div>
  );
}

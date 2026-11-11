// /test-dns: the dev-only outside world for the fake DNS, SES and HTTPS adapters (14-44;
// UI-SPEC "Test DNS page", D-UI-P14-24, P14-P32). The /test-pay layout: hub-surface-2 under the
// TestDnsStrip, a centred 720px panel. Robots: noindex.
// 404 when CDS_ENV=production or CDS_DNS_PROVIDER is not fake (T-14-44-01); every fake world
// function refuses in production as the second guard.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { testDnsDisabled } from "../../../lib/test-dns";
import { TestDnsStrip } from "./TestDnsStrip";

export const metadata: Metadata = {
  title: "Test DNS",
  robots: "noindex, nofollow",
};

export const dynamic = "force-dynamic";

export default function TestDnsLayout({ children }: { children: ReactNode }) {
  // testDnsDisabled() = CDS_ENV production, or dnsProviderMode() !== "fake".
  if (testDnsDisabled()) notFound();
  return (
    <div className="flex min-h-dvh flex-col bg-hub-surface-2 font-hub text-hub-ink">
      <TestDnsStrip />
      <main className="flex flex-1 items-start justify-center px-4 py-12">
        <div className="flex w-full max-w-[720px] flex-col gap-6 rounded-lg border border-hub-border bg-hub-surface p-6">
          {children}
        </div>
      </main>
    </div>
  );
}

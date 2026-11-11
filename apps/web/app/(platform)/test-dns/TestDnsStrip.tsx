// TestDnsStrip (14-44; UI-SPEC "Test DNS page", TEST-DNS-STRIP): the first element on `/test-dns`,
// the TestModeStrip geometry (40px warning tint, 14px icon) with its own text, so the page can
// never pass for a real DNS screen.
import { P14_COPY } from "@cds/core/dns";
import { TriangleAlert } from "lucide-react";

export function TestDnsStrip() {
  return (
    <div
      role="note"
      className="flex h-10 w-full items-center justify-center gap-2 bg-hub-warning-tint px-4 font-hub text-sm font-semibold text-hub-warning"
    >
      <TriangleAlert size={14} aria-hidden="true" className="shrink-0" />
      <span>{P14_COPY.TEST_DNS_STRIP}</span>
    </div>
  );
}

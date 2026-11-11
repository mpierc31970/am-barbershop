// /support-file-expired (12-07 choice 9; COMM-04; 12-UI-SPEC lines 519-521): where a genuine
// support-file link lands after its 15 minutes. Plain page in the P3 sign-in frame, outside
// the hub shell (the /download-expired precedent), so it reads the same signed in or out. No
// data, no session read: it says what happened and points back to Documents.
import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses } from "@cds/ui/hub";
import { SUPPORT_UI_COPY } from "@cds/ui/hub/support";

export const metadata: Metadata = {
  title: "Download link expired",
  robots: { index: false, follow: false },
};

const SUPPORT_FILE_EXPIRED_COPY = {
  title: "This download link has expired",
  body: SUPPORT_UI_COPY.LINK_EXPIRED,
  link: "Go to Documents",
} as const;

export default function SupportFileExpiredPage() {
  return (
    <main className="flex min-h-dvh items-start justify-center bg-hub-surface-2 px-4 py-12 font-hub text-hub-ink sm:items-center">
      <div className="w-full max-w-[400px] rounded-lg border border-hub-border bg-hub-surface p-6">
        <h1 className="mb-3 text-[1.75rem] leading-tight font-semibold">
          {SUPPORT_FILE_EXPIRED_COPY.title}
        </h1>
        <p className="mb-6 text-base text-hub-ink-muted">
          {SUPPORT_FILE_EXPIRED_COPY.body}
        </p>
        <Link
          href="/hub/support?tab=documents"
          className={buttonClasses("secondary", "md")}
        >
          {SUPPORT_FILE_EXPIRED_COPY.link}
        </Link>
      </div>
    </main>
  );
}

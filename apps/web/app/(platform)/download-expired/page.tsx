// /download-expired (11-41; LIFE-04; 11-UI-SPEC "Download my data"): where a genuine "Download
// my data" link lands after its 7 days (or once the zip was pruned). Plain page in the P3
// sign-in frame, outside the hub shell, so it reads the same signed in or out. No data, no
// session read: it only says what happened and how to get a new link.
import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses } from "@cds/ui/hub";

export const metadata: Metadata = {
  title: "Download link expired",
  robots: { index: false, follow: false },
};

const DOWNLOAD_EXPIRED_COPY = {
  title: "This download link has expired",
  body: "Ask for a new one from Settings › Business info.",
  link: "Go to your hub",
} as const;

export default function DownloadExpiredPage() {
  return (
    <main className="flex min-h-dvh items-start justify-center bg-hub-surface-2 px-4 py-12 font-hub text-hub-ink sm:items-center">
      <div className="w-full max-w-[400px] rounded-lg border border-hub-border bg-hub-surface p-6">
        <h1 className="mb-3 text-[1.75rem] leading-tight font-semibold">
          {DOWNLOAD_EXPIRED_COPY.title}
        </h1>
        <p className="mb-6 text-base text-hub-ink-muted">
          {DOWNLOAD_EXPIRED_COPY.body}
        </p>
        <Link
          href="/hub/settings?tab=business#your-data"
          className={buttonClasses("secondary", "md")}
        >
          {DOWNLOAD_EXPIRED_COPY.link}
        </Link>
      </div>
    </main>
  );
}

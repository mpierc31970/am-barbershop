// Email-link landing panel (06-UI-SPEC "Quote links"; the P3 sign-in pattern). Full-bleed
// --hub-surface-2, the wordmark above, then a centered --hub-surface panel: max 480px,
// 24px padding, 8px radius, 1px border. One <main>, one H1 per state. Server component.
import Link from "next/link";
import type { ReactNode } from "react";

export interface LinkPanelProps {
  /** Id of the panel's H1, for aria-labelledby. */
  titleId: string;
  children: ReactNode;
}

export function LinkPanel({ titleId, children }: LinkPanelProps) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-start gap-6 bg-hub-surface-2 px-4 py-12 font-hub text-hub-ink sm:justify-center">
      <Link href="/" className="text-base font-semibold">
        Connections Design Studios
      </Link>
      <section
        aria-labelledby={titleId}
        className="flex w-full max-w-[480px] flex-col gap-4 rounded-lg border border-hub-border bg-hub-surface p-6"
      >
        {children}
      </section>
    </main>
  );
}

export function LinkTitle({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  return (
    <h1
      id={id}
      tabIndex={-1}
      className="text-[1.75rem] leading-tight font-semibold outline-none"
    >
      {children}
    </h1>
  );
}

export function LinkBody({ children }: { children: ReactNode }) {
  return <p className="max-w-[68ch] text-hub-ink-muted">{children}</p>;
}

/**
 * The text link under a Done body ("Open my quote", "Back to your site's settings").
 * Never prefetched (B-WR-01): these panels sit on token-bearing email-link pages.
 */
export function LinkAction({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      className="inline-flex min-h-11 items-center self-start text-hub-accent underline underline-offset-4"
    >
      {children}
    </Link>
  );
}

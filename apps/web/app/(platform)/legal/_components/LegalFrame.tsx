// /legal frame (09-09; 09-UI-SPEC "Public policy pages"; CONTEXT A3-Q4): the StartFrame-style
// 64px top bar (text wordmark -> /, Sign in right), one <main>, and a quiet footer with Label
// ink-muted links to the five policies. Server component; reads only the compiled policy set.
import { activePolicyVersions } from "@cds/core/legal";
import Link from "next/link";
import type { ReactNode } from "react";

export function LegalFrame({ children }: { children: ReactNode }) {
  const policies = activePolicyVersions();
  return (
    <div className="min-h-dvh bg-hub-surface font-hub text-hub-ink">
      <header className="h-16 border-b border-hub-border">
        <div className="mx-auto flex h-full max-w-[1120px] items-center justify-between gap-4 px-4 md:px-8">
          <Link href="/" className="text-base font-semibold">
            A&M Barber Studio
          </Link>
          <Link
            href="/sign-in"
            className="text-sm text-hub-accent underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-[1120px] px-4 pt-8 pb-16 md:px-8 md:pt-16">
        {children}
      </main>
      <footer className="mx-auto flex max-w-[1120px] flex-col gap-2 border-t border-hub-border px-4 py-8 text-sm text-hub-ink-muted md:px-8">
        <nav aria-label="Policies">
          <ul className="flex flex-wrap gap-x-6">
            {policies.map((p) => (
              <li key={p.key}>
                <Link
                  href={`/legal/${p.key}`}
                  className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
                >
                  {p.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p>A&M Barber Studio</p>
      </footer>
    </div>
  );
}

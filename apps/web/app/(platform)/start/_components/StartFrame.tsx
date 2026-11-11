// /start frame (UI-SPEC "Configurator › Frame", Accessibility): 64px top bar with the
// wordmark, the "Quote steps" list and the sign-in link; one <main>; a quiet footer with
// the FAQ link. Presentational: the Configurator renders it with the current step, so the
// step list follows the visitor's choices without a reload. No eyebrow labels, no
// uppercase: the step list is a plain list (Typography rules).
import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import { LEGAL_LINKS } from "../../../../lib/legal-links";
import { STEPS, type StepNumber } from "./start-logic";

export interface StartFrameProps {
  step: StepNumber;
  onFaqLink?: (e: MouseEvent<HTMLAnchorElement>) => void;
  /** Prefix for the step and FAQ anchors: "" on /start, "/start" on /start/submit. */
  anchorBase?: string;
  children: ReactNode;
}

function StepList({
  step,
  anchorBase,
}: {
  step: StepNumber;
  anchorBase: string;
}) {
  return (
    <nav aria-label="Quote steps" className="hidden md:block">
      <ol className="flex items-center gap-6 text-sm">
        {STEPS.map((s) => {
          if (s.n === step) {
            return (
              <li key={s.n}>
                <span
                  aria-current="step"
                  className="border-b-2 border-hub-accent pb-1 font-semibold"
                >
                  {s.label}
                </span>
              </li>
            );
          }
          if (s.n < step && s.anchor) {
            return (
              <li key={s.n}>
                <a
                  href={`${anchorBase}#${s.anchor}`}
                  className="text-hub-accent underline-offset-4 hover:underline"
                >
                  {s.label}
                </a>
              </li>
            );
          }
          return (
            <li key={s.n} className="text-hub-ink-muted">
              {s.label}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function StartFrame({
  step,
  onFaqLink,
  anchorBase = "",
  children,
}: StartFrameProps) {
  const current = STEPS.find((s) => s.n === step)!;
  return (
    <div className="min-h-dvh bg-hub-surface font-hub text-hub-ink">
      <header className="h-16 border-b border-hub-border">
        <div className="mx-auto flex h-full max-w-[1120px] items-center justify-between gap-4 px-4 md:px-8">
          <Link href="/" className="text-base font-semibold">
            Connections Design Studios
          </Link>
          <StepList step={step} anchorBase={anchorBase} />
          <Link
            href="/sign-in"
            className="text-sm text-hub-accent underline-offset-4 hover:underline"
          >
            Already with us? Sign in
          </Link>
        </div>
      </header>
      <p className="px-4 pt-4 text-sm text-hub-ink-muted tabular-nums md:hidden">
        Step {step} of {STEPS.length} · {current.label}
      </p>
      <main className="mx-auto max-w-[1120px] px-4 pt-8 pb-24 md:px-8 md:pt-16 lg:pb-0">
        {children}
      </main>
      <footer className="mx-auto mt-16 flex max-w-[1120px] flex-col gap-2 px-4 pb-24 text-sm text-hub-ink-muted md:px-8 lg:pb-8">
        <p>
          Questions? Read{" "}
          <a
            href={`${anchorBase}#hosting-faq`}
            onClick={onFaqLink}
            className="text-hub-accent underline underline-offset-4"
          >
            Can my site be hosted here?
          </a>
        </p>
        {/* 09-09: the five public policies at /legal/<key> (CONTEXT A3-Q4). */}
        <nav aria-label="CDS policies">
          <ul className="flex flex-wrap gap-x-6">
            {LEGAL_LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
                >
                  {l.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p>Connections Design Studios</p>
      </footer>
    </div>
  );
}

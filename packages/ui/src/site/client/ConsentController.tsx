"use client";
// Cookie banner controller (CONT-34, D279; 07-UI-SPEC "CookieBanner"; D-UI-P7-18; 07-14
// choices 6, 9, 10).
//
// Mounted by the tenant layout only when the site needs consent, as its last child. The
// layout reads `cds_consent` server-side, so a returning visitor gets no banner flash:
// `initialChoice` set = rendered hidden (still mounted, so the footer link can reopen it).
// - A choice writes the cookie (180 days), fades the banner out (200 ms, instant under
//   reduced motion), moves focus to <main id="content"> only if focus was in the banner,
//   then announces `cds:consent` so frames load (on "all") and pop-ups may run.
// - While shown, <main id="content"> gets bottom padding equal to the banner height
//   (ResizeObserver), added below the content so nothing above moves (Pitfall 14).
// - CookieChoicesLink (07-25 puts it in the footer) reopens the banner.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ConsentChoice } from "@cds/core/content";
import { CookieBanner } from "./CookieBanner";
import {
  CONSENT_REOPEN_EVENT,
  announceConsent,
  reopenConsent,
  writeConsent,
} from "./consent-state";

export interface ConsentControllerProps {
  /** COOKIE-TEXT from cookieText(needs). */
  text: string;
  /** "/privacy" when a privacy page is published. */
  privacyHref?: string;
  /** The stored choice read server-side, or null when none. */
  initialChoice: ConsentChoice | null;
}

const LEAVE_MS = 200;
const REDUCED = "(prefers-reduced-motion: reduce)";

function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED).matches
  );
}

function focusMain(): void {
  const main = document.getElementById("content");
  if (!main) return;
  if (!main.hasAttribute("tabindex")) {
    main.setAttribute("tabindex", "-1");
    main.addEventListener("blur", () => main.removeAttribute("tabindex"), {
      once: true,
    });
  }
  main.focus({ preventScroll: true });
}

export function ConsentController({
  text,
  privacyHref,
  initialChoice,
}: ConsentControllerProps) {
  const [choice, setChoice] = useState<ConsentChoice | null>(initialChoice);
  const [open, setOpen] = useState(initialChoice === null);
  const [leaving, setLeaving] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onReopen = () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      setLeaving(false);
      setOpen(true);
    };
    document.addEventListener(CONSENT_REOPEN_EVENT, onReopen);
    return () => {
      document.removeEventListener(CONSENT_REOPEN_EVENT, onReopen);
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  // Reserve space below the content while the banner is shown (choice 9).
  useEffect(() => {
    const section = sectionRef.current;
    const main = document.getElementById("content");
    if (!open || !section || !main) return;
    const previous = main.style.paddingBottom;
    const apply = () => {
      main.style.paddingBottom = `${section.offsetHeight}px`;
    };
    apply();
    const ro =
      typeof ResizeObserver === "function" ? new ResizeObserver(apply) : null;
    ro?.observe(section);
    return () => {
      ro?.disconnect();
      main.style.paddingBottom = previous;
    };
  }, [open]);

  const choose = useCallback((c: ConsentChoice) => {
    const active = document.activeElement;
    const inside = !!active && !!sectionRef.current?.contains(active);
    writeConsent(c);
    setChoice(c);
    setLeaving(true);
    const finish = () => {
      timer.current = null;
      setOpen(false);
      setLeaving(false);
      if (inside) focusMain();
      announceConsent(c);
    };
    if (timer.current !== null) clearTimeout(timer.current);
    if (reducedMotion()) finish();
    else timer.current = setTimeout(finish, LEAVE_MS);
  }, []);

  return (
    <CookieBanner
      text={text}
      privacyHref={privacyHref}
      open={open}
      leaving={leaving}
      pending={open && choice === null}
      onChoose={choose}
      sectionRef={sectionRef}
    />
  );
}

export interface CookieChoicesLinkProps {
  className?: string;
}

/** Footer link that reopens the cookie banner (07-25 places it). */
export function CookieChoicesLink({ className }: CookieChoicesLinkProps) {
  return (
    <button
      type="button"
      onClick={() => reopenConsent(document)}
      className={
        className ??
        "inline-flex min-h-11 cursor-pointer items-center bg-transparent p-0 text-site-text-muted hover:underline"
      }
    >
      Cookie choices
    </button>
  );
}

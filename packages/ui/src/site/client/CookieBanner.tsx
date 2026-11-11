"use client";
// Cookie banner, presentational (CONT-34, D279; 07-UI-SPEC "CookieBanner"; D-UI-P7-18;
// RESEARCH Pitfall 14).
//
// Fixed to the bottom, full width, surface-raised with a 1 px top border, 1120 px container,
// padding 16/24 px. Not a dialog and never a focus trap: content stays usable (UI-SPEC a11y).
// Accept all and Only necessary are both the secondary style at equal size (no nudging).
// Row on ≥768 px (text left, buttons right); stacked below with the two buttons side by side
// at 50 % each. Leaves with a 200 ms fade (instant under reduced motion). The SSR'd banner
// carries `data-cds-consent-pending` while no choice exists, so pop-ups wait (choice 6).
import type { Ref } from "react";
import type { ConsentChoice } from "@cds/core/content";
import { siteButtonClasses } from "../SiteButton";
import { BODY_CLASS } from "../types";
import { PENDING_ATTR } from "./consent-state";

export interface CookieBannerProps {
  text: string;
  privacyHref?: string;
  open: boolean;
  leaving: boolean;
  pending: boolean;
  onChoose: (choice: ConsentChoice) => void;
  sectionRef?: Ref<HTMLElement>;
}

const SECTION =
  "fixed inset-x-0 bottom-0 z-40 border-t border-site-border bg-site-surface-raised " +
  "text-site-text transition-opacity duration-200 motion-reduce:transition-none";

const BUTTON = `${siteButtonClasses("secondary")} min-w-0 flex-1 basis-0 md:w-40 md:flex-none md:basis-auto`;

export function CookieBanner({
  text,
  privacyHref,
  open,
  leaving,
  pending,
  onChoose,
  sectionRef,
}: CookieBannerProps) {
  return (
    <section
      ref={sectionRef}
      role="region"
      aria-label="Cookie choices"
      data-cds-consent-banner=""
      {...(pending ? { [PENDING_ATTR]: "" } : {})}
      hidden={!open}
      className={`${SECTION} ${leaving ? "opacity-0" : "opacity-100"}`}
    >
      <div className="mx-auto flex max-w-[1120px] flex-col gap-4 px-6 py-4 md:flex-row md:items-center md:justify-between md:gap-8">
        <p className={`${BODY_CLASS} max-w-[65ch]`}>
          {text}
          {privacyHref ? (
            <>
              {" "}
              <a
                href={privacyHref}
                className="font-semibold text-site-text underline underline-offset-2"
              >
                Privacy
              </a>
            </>
          ) : null}
        </p>
        <div className="flex gap-3 md:shrink-0">
          <button
            type="button"
            className={BUTTON}
            onClick={() => onChoose("all")}
          >
            Accept all
          </button>
          <button
            type="button"
            className={BUTTON}
            onClick={() => onChoose("necessary")}
          >
            Only necessary
          </button>
        </div>
      </div>
    </section>
  );
}

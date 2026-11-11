"use client";
// "Your site's style": the font pairing cards (06-19; 06-UI-SPEC "Font pairing cards";
// ONB-01, CONTEXT A4-Q4, D-UI-P6-26). Seven RadioCards from the P4 catalog pairings, "Let CDS
// choose" first and the default. Each card carries a live sample inside a [data-site]
// wrapper (SiteThemeScope, the P4 hub-preview pattern): the business name at --site-text-h3
// in the heading face over a neutral line at --site-text-body in the body face.
//
// Each sample gets its own theme scope: the neutral design with the pairing's faces and a
// fixed preview hash (fffffff0..fffffff6), so the seven scopes never override each other or
// collide with a tenant's hash. Faces come from resolveTheme (the P4 grammar), never a
// font-family literal here. Font files load lazily: the samples switch to their faces only
// once the group scrolls into view (IntersectionObserver); the browser downloads a woff2 only
// when a rendered element uses it (font-display: swap, root layout).
import {
  FONT_PAIRINGS,
  NEUTRAL_DESIGN,
  resolveTheme,
  type FontPairing,
} from "@cds/core/theme";
import { RadioCardGroup } from "@cds/ui/hub";
import { SiteThemeScope } from "@cds/ui/site/client";
import { useEffect, useMemo, useRef, useState } from "react";

export const SAMPLE_LINE =
  "Fresh bread every morning. Order ahead for weekends.";

type Theme = { hash: string; css: string };

/** The preview theme for one pairing card (the neutral design with its faces). */
export function pairingTheme(p: FontPairing, index: number): Theme {
  return resolveTheme({
    ...NEUTRAL_DESIGN,
    typography: {
      ...NEUTRAL_DESIGN.typography,
      headingFamily: p.heading ?? "System Sans",
      bodyFamily: p.body ?? "System Sans",
    },
    sourceHash: `fffffff${index.toString(16)}${"f".repeat(56)}`,
  });
}

const NEUTRAL_THEME = resolveTheme(null);

export interface FontPairingPickerProps {
  value: string;
  businessName: string;
  readOnly: boolean;
  onChange: (id: string) => void;
  error?: string;
}

export function FontPairingPicker({
  value,
  businessName,
  readOnly,
  onChange,
  error,
}: FontPairingPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver !== "function") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const themes = useMemo(
    () => FONT_PAIRINGS.map((p, i) => pairingTheme(p, i)),
    [],
  );
  const name = businessName.trim() || "Your business";

  return (
    <div
      ref={ref}
      id="field-font_pairing"
      tabIndex={-1}
      className="flex flex-col gap-2 outline-none"
      data-fonts-loaded={inView || undefined}
    >
      <RadioCardGroup
        name="font_pairing"
        legend="Your site's style"
        options={FONT_PAIRINGS.map((p, i) => ({
          value: p.id,
          title: p.label,
          ...(p.helper ? { description: p.helper } : {}),
          disabled: readOnly,
          body: (
            <SiteThemeScope
              as="span"
              theme={inView ? themes[i]! : NEUTRAL_THEME}
              className="block rounded border border-hub-border bg-site-surface px-4 py-3"
            >
              <span
                aria-hidden="true"
                className="block font-site-heading text-[length:var(--site-text-h3)] leading-tight text-site-text"
              >
                {name}
              </span>
              <span
                aria-hidden="true"
                className="mt-1 block font-site-body text-[length:var(--site-text-body)] text-site-text-muted"
              >
                {SAMPLE_LINE}
              </span>
            </SiteThemeScope>
          ),
        }))}
        value={value || FONT_PAIRINGS[0]!.id}
        onChange={onChange}
      />
      {error ? <p className="text-sm text-hub-danger">{error}</p> : null}
    </div>
  );
}

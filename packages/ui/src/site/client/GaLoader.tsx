"use client";
// Consent-gated GA4 loader (11-32; DASH-11, CONT-34, D279; T-11-32-02, T-11-32-03).
//
// Mounted by the tenant layout only when the org has a GA4 measurement id (staff set it with
// analytics:set). It renders nothing. The gtag script is injected only once the visitor's
// stored choice is "all" (statistics included): on mount for a returning visitor, else on the
// `cds:consent` event from the cookie banner. Never before. A "necessary" choice never loads
// it; switching to "necessary" after loading sets GA's own `ga-disable-<id>` flag so nothing
// more is sent this page view, and expires the `_ga` / `_ga_<container>` cookies gtag set
// (review 11 WR-D06): withdrawing consent is as complete as giving it. A returning visitor
// whose stored choice is "necessary" gets the same sweep. `anonymize_ip` stays in the config
// call for the plan's record, but GA4 ignores it (GA4 does not log or store IP addresses);
// data retention is set in the GA4 property (docs/ops/ga4-search-console.md). The id is
// checked against the G- pattern and URL-encoded, so nothing odd reaches the script URL.
import { useEffect } from "react";
import {
  CONSENT_EVENT,
  choiceOf,
  clearGaCookies,
  storedConsent,
} from "./consent-state";

export const GA_SCRIPT_ATTR = "data-cds-ga";
const GA_ID_RE = /^G-[A-Z0-9]{4,12}$/;
const GTAG_SRC = "https://www.googletagmanager.com/gtag/js?id=";

export interface GaLoaderProps {
  measurementId: string;
}

type GaWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
} & Record<string, unknown>;

function setDisabled(id: string, disabled: boolean): void {
  (window as unknown as GaWindow)[`ga-disable-${id}`] = disabled;
}

function withdraw(id: string): void {
  setDisabled(id, true);
  clearGaCookies();
}

function loadGa(id: string): void {
  setDisabled(id, false);
  if (document.querySelector(`script[${GA_SCRIPT_ATTR}]`)) return;
  const w = window as unknown as GaWindow;
  w.dataLayer = w.dataLayer ?? [];
  // gtag pushes the `arguments` object itself (Google's snippet); a plain array is ignored.
  w.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer!.push(arguments);
  };
  w.gtag("js", new Date());
  w.gtag("config", id, { anonymize_ip: true });
  const s = document.createElement("script");
  s.async = true;
  s.src = `${GTAG_SRC}${encodeURIComponent(id)}`;
  s.setAttribute(GA_SCRIPT_ATTR, "");
  document.head.appendChild(s);
}

export function GaLoader({ measurementId }: GaLoaderProps) {
  useEffect(() => {
    const id = typeof measurementId === "string" ? measurementId : "";
    if (!GA_ID_RE.test(id)) return;
    const stored = storedConsent();
    if (stored === "all") loadGa(id);
    else if (stored === "necessary") clearGaCookies();
    const onChoice = (e: Event) => {
      const choice = choiceOf(e);
      if (choice === "all") loadGa(id);
      else if (choice === "necessary") withdraw(id);
    };
    document.addEventListener(CONSENT_EVENT, onChoice);
    return () => document.removeEventListener(CONSENT_EVENT, onChoice);
  }, [measurementId]);
  return null;
}

"use client";
// Beacon: the cookieless first-party site metrics island (11-31 choices 2-3; DASH-11, DASH-15;
// RESEARCH Pattern 11, Pitfall 10; 11-UI-SPEC "Performance"; T-11-31-03).
//
// Mounted once by the tenant layout (live hosts only; the server drops everything else too).
// It renders nothing and does nothing until the browser is idle (requestIdleCallback, else a
// 2 s timeout), so it never sits on the critical path. Then:
//   - one page view `{ t: "v", p, r, us, um, d }`, or `{ t: "n", ... }` when the page carries
//     the 404 marker (`[data-cds-404]`, rendered by the tenant not-found page);
//   - web-vitals is imported dynamically; LCP, INP and CLS are sent once, on the first
//     `visibilitychange` to hidden, as `{ t: "w", p, lcp?, inp?, cls?, ... }`;
//   - `{ t: "c", ... }` on the `cds:form-submitted` window event (FormEnhancer, after a
//     successful send).
// Source: UTM from the address first, else the referrer host. The landing source is kept in
// sessionStorage `cds_src` (this tab only; never a cookie), so later pages of the same visit and
// a conversion credit the source the visitor arrived from. Every event carries the source and
// device so vitals and conversions land on the page's own stats row. No ids, no cookies, no
// fingerprinting; `navigator.sendBeacon("/api/m", <JSON text>)` only.
import { useEffect } from "react";

/** The window event FormEnhancer dispatches after a successful submit (choice 3). */
export const FORM_SUBMITTED_EVENT = "cds:form-submitted";

const ENDPOINT = "/api/m";
const SRC_KEY = "cds_src";
const PATH_MAX = 300;
const LABEL_MAX = 40;
const IDLE_FALLBACK_MS = 2000;

type Source = { r: string; us: string; um: string };
type Device = "m" | "t" | "c";

/** Device class from the viewport width: phone < 768, tablet < 1100, else computer. */
export function deviceClass(width: number): Device {
  if (width < 768) return "m";
  if (width < 1100) return "t";
  return "c";
}

function send(body: Record<string, unknown>): void {
  try {
    if (typeof navigator.sendBeacon !== "function") return;
    navigator.sendBeacon(ENDPOINT, JSON.stringify(body));
  } catch {
    // A refused beacon is never the visitor's problem.
  }
}

function referrerHost(): string {
  try {
    return document.referrer ? new URL(document.referrer).hostname : "";
  } catch {
    return "";
  }
}

function readStored(): Source | null {
  try {
    const raw = sessionStorage.getItem(SRC_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<Source>;
    return {
      r: typeof o.r === "string" ? o.r : "",
      us: typeof o.us === "string" ? o.us : "",
      um: typeof o.um === "string" ? o.um : "",
    };
  } catch {
    return null;
  }
}

function store(src: Source): void {
  try {
    sessionStorage.setItem(SRC_KEY, JSON.stringify(src));
  } catch {
    // Storage off (private mode): the source is simply not kept.
  }
}

/** This page's source: a new UTM or an outside referrer starts a new landing. */
function currentSource(): Source {
  const q = new URLSearchParams(window.location.search);
  const us = (q.get("utm_source") ?? "").slice(0, LABEL_MAX);
  const um = (q.get("utm_medium") ?? "").slice(0, LABEL_MAX);
  const ref = referrerHost();
  const internal = ref === "" || ref === window.location.hostname;
  if (us === "" && internal) {
    const kept = readStored();
    if (kept) return kept;
  }
  const src: Source = { r: internal ? "" : ref, us, um };
  store(src);
  return src;
}

function afterIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(run, { timeout: 5000 });
    return () => window.cancelIdleCallback?.(id);
  }
  const t = window.setTimeout(run, IDLE_FALLBACK_MS);
  return () => window.clearTimeout(t);
}

/** Starts the beacon for this page; returns the cleanup. */
function startBeacon(): () => void {
  const p = window.location.pathname.slice(0, PATH_MAX) || "/";
  const src = currentSource();
  const d = deviceClass(window.innerWidth);
  const base = { p, ...src, d };
  const notFound = document.querySelector("[data-cds-404]") !== null;
  send({ t: notFound ? "n" : "v", ...base });

  const q: { lcp?: number; inp?: number; cls?: number } = {};
  let vitalsSent = false;
  let alive = true;
  function onHide() {
    if (document.visibilityState !== "hidden" || vitalsSent) return;
    if (Object.keys(q).length === 0) return;
    vitalsSent = true;
    send({ t: "w", ...base, ...q });
  }
  function onConversion() {
    send({ t: "c", ...base });
  }
  window.addEventListener(FORM_SUBMITTED_EVENT, onConversion);
  if (!notFound) {
    import("web-vitals")
      .then(({ onLCP, onINP, onCLS }) => {
        if (!alive) return;
        onLCP((m) => (q.lcp = Math.round(m.value)));
        onINP((m) => (q.inp = Math.round(m.value)));
        onCLS((m) => (q.cls = Math.round(m.value * 1000) / 1000));
        // Registered after web-vitals' own listeners, so its final values are in q first.
        document.addEventListener("visibilitychange", onHide);
      })
      .catch(() => undefined);
  }
  return () => {
    alive = false;
    window.removeEventListener(FORM_SUBMITTED_EVENT, onConversion);
    document.removeEventListener("visibilitychange", onHide);
  };
}

/** The tenant beacon island: renders nothing. */
export function Beacon(): null {
  useEffect(() => {
    let stop: (() => void) | null = null;
    const cancel = afterIdle(() => {
      stop = startBeacon();
    });
    return () => {
      cancel();
      stop?.();
    };
  }, []);
  return null;
}

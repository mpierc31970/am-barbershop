"use client";
// Settings › Business info › Your data (11-41; LIFE-04; D284, D285; 11-UI-SPEC "Download my
// data" lines 886-911, Copywriting DATA-*). Display only: the server builds the view (dates in
// the business time zone, the signed link) and the app passes two callbacks.
//   - Owner: Idle (secondary Download my data) · Building (DATA-BUILDING, disabled
//     "Preparing your download…", polls `refresh` every 15 s until it settles) · Ready
//     (success alert with the expiry, primary Download your data link whose accessible name
//     carries "zip, 1.4 GB", "Requested …") · Failed (DATA-FAILED + Try again). Inside the
//     24-hour limit the request button is aria-disabled and described by DATA-LIMIT.
//   - Admin / Editor: the "Only the site owner…" line, no button.
//   - CDS staff impersonating: IMPERSONATING-DATA, no button (D285).
// No confirm dialog: asking for a download changes nothing.
import { Download } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button, buttonClasses } from "../Button";
import { InlineAlert } from "../feedback";

export type DataDownloadViewer = "owner" | "not-owner" | "impersonating";
export type DataDownloadStatus = "idle" | "building" | "ready" | "failed";

/** Server-built panel state (apps/web lib/data-download-view.ts). Labels are display text. */
export type DataDownloadView = {
  viewer: DataDownloadViewer;
  status: DataDownloadStatus;
  /** Ready only: the signed link path, "16 Oct", and "1.4 GB" (null when unknown). */
  ready: { href: string; until: string; size: string | null } | null;
  /** "9 Oct, 2:14 pm": when the latest download was asked for (Ready). */
  requested: string | null;
  /** "2:14 pm tomorrow" while the one-a-day limit applies, else null. */
  limitUntil: string | null;
};

export type DataDownloadRequestResult =
  { ok: true; view: DataDownloadView } | { ok: false; message: string };

export interface DataDownloadPanelProps {
  /** null: the state could not be read (ERR-SECTION with Try again). */
  initial: DataDownloadView | null;
  /** Ask for a download; answers with the fresh view (a refusal is a view too). */
  onRequest: () => Promise<DataDownloadRequestResult>;
  /** Re-read the state while Building; null on a failed read (keep polling). */
  onRefresh: () => Promise<DataDownloadView | null>;
  /** Poll interval while Building (ms). */
  pollMs?: number;
  /** Where "Try again" goes when the first read failed. */
  retryHref?: string;
}

export const DATA_DOWNLOAD_POLL_MS = 15_000;

export const DATA_COPY = {
  heading: "Your data",
  intro:
    "Download a copy of everything on your site: a spreadsheet (CSV) for each kind of record, such as pages, contacts and form messages, and a zip of your photos and files. Passwords, card details and security keys are never included.",
  request: "Download my data",
  requestAgain: "Ask for a new download",
  idleHint: "Takes a few minutes. We'll email you when it's ready.",
  building:
    "We're putting your download together. Large media libraries can take a while. We'll email you and show it in your alerts when it's ready.",
  preparing: "Preparing your download…",
  download: "Download your data",
  failed:
    "We couldn't build your download, and nothing was lost. Try again, or contact CDS Support if it keeps happening.",
  tryAgain: "Try again",
  notOwner: "Only the site owner can download the site's data.",
  impersonating:
    "You're viewing as CDS staff, so downloads are turned off. Only the owner can download the site's data.",
  loadFailed: "We couldn't load this part. The rest of the page is fine.",
  requestFailed:
    "We couldn't start your download just now. Try again in a minute.",
} as const;

/** DATA-LIMIT. */
export function dataLimitCopy(until: string): string {
  return `You can ask for a new download after ${until}.`;
}

/** Ready alert: "Your download is ready. The link works until 16 Oct." */
export function dataReadyCopy(until: string): string {
  return `Your download is ready. The link works until ${until}.`;
}

/** "Download your data (zip, 1.4 GB)" for screen readers. */
export function dataDownloadLabel(size: string | null): string {
  return `${DATA_COPY.download} (zip${size ? `, ${size}` : ""})`;
}

export function dataRequestedCopy(when: string): string {
  return `Requested ${when}`;
}

function Heading({ id }: { id: string }) {
  return (
    <h2 id={id} className="text-xl leading-tight font-semibold text-hub-ink">
      {DATA_COPY.heading}
    </h2>
  );
}

export function DataDownloadPanel({
  initial,
  onRequest,
  onRefresh,
  pollMs = DATA_DOWNLOAD_POLL_MS,
  retryHref = "/hub/settings?tab=business#your-data",
}: DataDownloadPanelProps) {
  const headingId = useId();
  const limitId = useId();
  const hintId = useId();
  const [view, setView] = useState<DataDownloadView | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => setView(initial), [initial]);

  const building = view?.status === "building";
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  useEffect(() => {
    if (!building) return;
    let stopped = false;
    const timer = setInterval(() => {
      void refresh
        .current()
        .then((next) => {
          if (!stopped && next) setView(next);
        })
        .catch(() => {
          // A failed poll keeps the Building state; the next tick tries again.
        });
    }, pollMs);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [building, pollMs]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const ask = useCallback(async () => {
    if (busy || !view || view.limitUntil || view.status === "building") return;
    setBusy(true);
    setError(null);
    try {
      const res = await onRequest();
      if (res.ok) setView(res.view);
      else setError(res.message);
    } catch {
      setError(DATA_COPY.requestFailed);
    } finally {
      setBusy(false);
    }
  }, [busy, onRequest, view]);

  let body: ReactNode;
  if (!view) {
    body = (
      <InlineAlert
        tone="error"
        action={
          <a href={retryHref} className={buttonClasses("secondary", "sm")}>
            {DATA_COPY.tryAgain}
          </a>
        }
      >
        {DATA_COPY.loadFailed}
      </InlineAlert>
    );
  } else if (view.viewer === "impersonating") {
    body = <InlineAlert tone="info">{DATA_COPY.impersonating}</InlineAlert>;
  } else if (view.viewer === "not-owner") {
    body = <p className="text-sm text-hub-ink-muted">{DATA_COPY.notOwner}</p>;
  } else {
    const limited = Boolean(view.limitUntil);
    const requestButton = (label: string, variant: "secondary") => (
      <Button
        variant={variant}
        icon={<Download aria-hidden size={16} strokeWidth={2} />}
        loading={busy}
        aria-disabled={limited || undefined}
        aria-describedby={limited ? limitId : hintId}
        onClick={() => void ask()}
      >
        {label}
      </Button>
    );
    const limitLine = limited ? (
      <p id={limitId} className="text-sm text-hub-ink-muted">
        {dataLimitCopy(view.limitUntil ?? "")}
      </p>
    ) : null;

    if (view.status === "building") {
      body = (
        <>
          <InlineAlert tone="info">{DATA_COPY.building}</InlineAlert>
          <div>
            <Button
              variant="secondary"
              loading
              loadingLabel={DATA_COPY.preparing}
            >
              {DATA_COPY.request}
            </Button>
          </div>
        </>
      );
    } else if (view.status === "ready" && view.ready) {
      body = (
        <>
          <InlineAlert tone="success">
            {dataReadyCopy(view.ready.until)}
          </InlineAlert>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={view.ready.href}
              download
              aria-label={dataDownloadLabel(view.ready.size)}
              className={buttonClasses("primary", "md")}
            >
              <Download aria-hidden size={16} strokeWidth={2} />
              {DATA_COPY.download}
            </a>
            {requestButton(DATA_COPY.requestAgain, "secondary")}
          </div>
          {view.requested ? (
            <p id={hintId} className="text-sm text-hub-ink-muted">
              {dataRequestedCopy(view.requested)}
            </p>
          ) : null}
          {limitLine}
        </>
      );
    } else if (view.status === "failed") {
      body = (
        <InlineAlert
          tone="error"
          action={
            <Button
              variant="secondary"
              size="sm"
              loading={busy}
              onClick={() => void ask()}
            >
              {DATA_COPY.tryAgain}
            </Button>
          }
        >
          {DATA_COPY.failed}
        </InlineAlert>
      );
    } else {
      body = (
        <>
          <div>{requestButton(DATA_COPY.request, "secondary")}</div>
          {limited ? (
            limitLine
          ) : (
            <p id={hintId} className="text-sm text-hub-ink-muted">
              {DATA_COPY.idleHint}
            </p>
          )}
        </>
      );
    }
  }

  return (
    <section
      id="your-data"
      aria-labelledby={headingId}
      data-status={view?.status ?? "error"}
      className="flex max-w-[720px] scroll-mt-20 flex-col gap-4 font-hub"
    >
      <Heading id={headingId} />
      <p className="text-base text-hub-ink">{DATA_COPY.intro}</p>
      <div aria-live="polite" className="flex flex-col gap-3">
        {body}
      </div>
      {error ? (
        <div ref={errorRef} tabIndex={-1}>
          <InlineAlert tone="error">{error}</InlineAlert>
        </div>
      ) : null}
    </section>
  );
}

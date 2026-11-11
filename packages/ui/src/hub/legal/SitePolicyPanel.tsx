"use client";
// SitePolicyPanel: Settings › Legal section 2 "Your site's policy pages" (09-23; AGR-08;
// D217, D287; CONTEXT A5-Q3, A5-Q4; 09-UI-SPEC section 2, "Preview drawer"; D-UI-P9-12,
// D-UI-P9-18, D-UI-P9-20).
//
// Order: heading, intro, notices (WARN-LEGAL first and never dismissible, then ADDON-CHANGED,
// MISSING-LEGAL-INPUTS, TEMPLATE-UPDATE), the two pages (badge, Covers line, Preview, View on
// your site when published), then the acknowledge-and-publish block for the Owner. The box is
// never pre-ticked; Publish is aria-disabled (still focusable) with a reason line until it is
// ticked. Admins and impersonating staff see the read-only reason, never the checkbox or the
// button (the server refuses them too). No unpublish control (D-UI-P9-12).
//
// SECURITY (T-09-23-02): onPreview returns HTML the Server Action already sanitised; this
// component never builds HTML itself and only hands it to LegalProse.
// Controlled and data-free: apps/web passes the rows, notices and the action adapters.
import { ExternalLink, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { Drawer } from "../Drawer";
import { InlineAlert, Skeleton } from "../feedback";
import { IconButton } from "../IconButton";
import { useToast } from "../Toast";
import { LegalProse } from "./LegalProse";
import { AcceptRow } from "./PolicyCard";

export type SitePolicyPage = "privacy" | "terms";

export interface SitePolicyRowView {
  page: SitePolicyPage;
  label: string;
  badge: { tone: "draft" | "published" | "update-waiting"; text: string };
  covers: string | null;
}

export interface SitePolicyNoticeView {
  key: string;
  tone: "warning" | "info";
  title: string | null;
  text: string;
  link: { label: string; href: string } | null;
}

export interface SitePolicyPanelProps {
  rows: readonly SitePolicyRowView[];
  notices: readonly SitePolicyNoticeView[];
  /** The Owner, signed in as themselves. */
  canPublish: boolean;
  /** "Only the site owner can publish these pages." / IMPERSONATING-ACK, or null. */
  readOnlyReason: string | null;
  published: boolean;
  updateWaiting: boolean;
  /** ACKED-LINE, or null when unpublished or an update waits. */
  ackedLine: string | null;
  missingInputs: boolean;
  onPreview: (
    page: SitePolicyPage,
  ) => Promise<{ title: string; html: string } | { error: string }>;
  onPublish: () => Promise<{ ok: boolean; message?: string }>;
  viewHrefs: { privacy: string | null; terms: string | null };
}

export const SITE_POLICY_COPY = {
  heading: "Your site's policy pages",
  intro:
    "A privacy policy and terms for your site, written from what your site collects. They update when you add or remove add-ons.",
  preview: "Preview page",
  view: "View on your site",
  previewHelper:
    "This is how it reads today. Your site shows it in your theme.",
  close: "Close",
  ack: "I understand this site gives no legal advice, and I'll have my own lawyer approve these pages.",
  publish: "Publish policy pages",
  publishUpdate: "Publish the update",
  publishing: "Publishing…",
  reason: "Tick the box above to publish.",
  toast: "Policy pages published. Links are in your site's footer.",
  errPublish:
    "We couldn't publish your policy pages. Nothing changed on your site. Try again in a minute.",
  errPreview: "We couldn't load this. Check your connection and try again.",
} as const;

const DRAWER_TITLE: Record<SitePolicyPage, string> = {
  privacy: "Privacy policy preview",
  terms: "Terms preview",
};

const DISABLED_LOOK =
  "aria-disabled:cursor-not-allowed aria-disabled:opacity-50 " +
  "aria-disabled:hover:bg-hub-accent aria-disabled:active:bg-hub-accent";

type DrawerState =
  | { page: SitePolicyPage; status: "loading" }
  | { page: SitePolicyPage; status: "ready"; html: string }
  | { page: SitePolicyPage; status: "error"; message: string };

export function SitePolicyPanel({
  rows,
  notices,
  canPublish,
  readOnlyReason,
  published,
  updateWaiting,
  ackedLine,
  missingInputs,
  onPreview,
  onPublish,
  viewHrefs,
}: SitePolicyPanelProps) {
  const uid = useId();
  const headingId = `site-policies-${uid}`;
  const reasonId = `site-policies-reason-${uid}`;
  const toast = useToast();
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [ticked, setTicked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const needsAck = !published || updateWaiting;
  const showBlock = canPublish && needsAck && !missingInputs && !done;

  // WR-B05: each open (and each close) bumps the counter, so a late response from an earlier
  // open never overwrites the drawer the user is looking at now.
  const previewSeq = useRef(0);

  function closeDrawer() {
    previewSeq.current += 1;
    setDrawer(null);
  }

  async function openPreview(page: SitePolicyPage) {
    if (missingInputs) return;
    const seq = ++previewSeq.current;
    setDrawer({ page, status: "loading" });
    let next: DrawerState;
    try {
      const res = await onPreview(page);
      next =
        "error" in res
          ? { page, status: "error", message: res.error }
          : { page, status: "ready", html: res.html };
    } catch {
      next = { page, status: "error", message: SITE_POLICY_COPY.errPreview };
    }
    if (seq === previewSeq.current) setDrawer(next);
  }

  async function publish() {
    if (pending) return;
    if (!ticked) return;
    setPending(true);
    setError(null);
    try {
      const res = await onPublish();
      if (res.ok) {
        setDone(true);
        setTicked(false);
        toast.show({ message: SITE_POLICY_COPY.toast });
        return;
      }
      setError(res.message ?? SITE_POLICY_COPY.errPublish);
    } catch {
      setError(SITE_POLICY_COPY.errPublish);
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 font-hub"
    >
      <h2
        id={headingId}
        className="text-xl leading-tight font-semibold text-hub-ink"
      >
        {SITE_POLICY_COPY.heading}
      </h2>
      <p className="max-w-[68ch] text-base text-hub-ink-muted">
        {SITE_POLICY_COPY.intro}
      </p>

      {notices.map((n) => (
        <InlineAlert
          key={n.key}
          tone={n.tone}
          title={n.title ?? undefined}
          action={
            n.link ? (
              <a
                href={n.link.href}
                className="text-sm font-semibold text-hub-accent underline underline-offset-2 hover:text-hub-accent-hover"
              >
                {n.link.label}
              </a>
            ) : undefined
          }
        >
          {n.text}
        </InlineAlert>
      ))}

      <ul className="flex flex-col divide-y divide-hub-border border-y border-hub-border">
        {rows.map((r) => {
          const href = published ? viewHrefs[r.page] : null;
          return (
            <li
              key={r.page}
              className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold text-hub-ink">
                    {r.label}
                  </span>
                  <Badge tone={r.badge.tone}>{r.badge.text}</Badge>
                </div>
                {r.covers ? (
                  <p className="text-sm text-hub-ink-muted">{r.covers}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  aria-label={`${SITE_POLICY_COPY.preview}: ${r.label}`}
                  aria-disabled={missingInputs ? true : undefined}
                  className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                  onClick={() => void openPreview(r.page)}
                >
                  {SITE_POLICY_COPY.preview}
                </Button>
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-hub-accent underline underline-offset-2 hover:text-hub-accent-hover"
                  >
                    {SITE_POLICY_COPY.view}
                    <ExternalLink aria-hidden size={16} strokeWidth={2} />
                    <span className="sr-only">
                      {` (${r.label}, opens in a new tab)`}
                    </span>
                  </a>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}

      {showBlock ? (
        <div className="flex flex-col gap-2">
          <AcceptRow
            id={`site-policies-ack-${uid}`}
            name="site-policies-ack"
            label={SITE_POLICY_COPY.ack}
            checked={ticked}
            onCheckedChange={setTicked}
            readOnly={false}
            disabled={pending}
          />
          <Button
            variant="primary"
            type="button"
            className={`w-full sm:w-auto sm:self-start ${DISABLED_LOOK}`}
            loading={pending}
            loadingLabel={SITE_POLICY_COPY.publishing}
            aria-disabled={!ticked && !pending ? true : undefined}
            aria-describedby={!ticked ? reasonId : undefined}
            onClick={() => void publish()}
          >
            {updateWaiting && published
              ? SITE_POLICY_COPY.publishUpdate
              : SITE_POLICY_COPY.publish}
          </Button>
          <p
            id={reasonId}
            aria-live="polite"
            className="text-sm text-hub-ink-muted"
          >
            {ticked ? "" : SITE_POLICY_COPY.reason}
          </p>
        </div>
      ) : null}

      {!canPublish && needsAck && readOnlyReason ? (
        <p className="text-sm text-hub-ink-muted">{readOnlyReason}</p>
      ) : null}

      {ackedLine && !showBlock ? (
        <p className="text-sm text-hub-ink-muted tabular-nums">{ackedLine}</p>
      ) : null}

      <Drawer
        open={drawer !== null}
        onClose={closeDrawer}
        label={drawer ? DRAWER_TITLE[drawer.page] : "Preview"}
        side="right"
      >
        {drawer ? (
          <>
            <div className="flex items-center justify-between gap-2 border-b border-hub-border px-6 py-4">
              <h2 className="text-xl leading-tight font-semibold">
                {DRAWER_TITLE[drawer.page]}
              </h2>
              <IconButton
                label={SITE_POLICY_COPY.close}
                tooltipAlign="end"
                onClick={closeDrawer}
                icon={<X aria-hidden size={20} strokeWidth={2} />}
              />
            </div>
            <div className="flex flex-1 flex-col gap-6 px-6 py-6">
              <p className="text-sm text-hub-ink-muted">
                {SITE_POLICY_COPY.previewHelper}
              </p>
              {drawer.status === "loading" ? (
                <Skeleton rows={6} rowHeight={24} />
              ) : drawer.status === "error" ? (
                <InlineAlert tone="error">{drawer.message}</InlineAlert>
              ) : (
                <LegalProse html={drawer.html} />
              )}
            </div>
            <div className="flex justify-end border-t border-hub-border px-6 py-4">
              <Button variant="secondary" type="button" onClick={closeDrawer}>
                {SITE_POLICY_COPY.close}
              </Button>
            </div>
          </>
        ) : null}
      </Drawer>
    </section>
  );
}

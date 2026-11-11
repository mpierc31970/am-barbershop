"use client";
// DocumentList (12-11 choice 3; COMM-04, D187, D-UI-P12-14; 12-UI-SPEC Documents lines
// 503-521). Two sections:
//   1. Shared by CDS — wrapped in `data-cds-identity`; rows: type icon 20 · title + note
//      (2-line clamp, Show more) + CdsMark 16 "From CDS · 9 Oct · 1.2 MB" · Download (name
//      "Download {title}, PDF, 1.2 MB"); unread rows get "New".
//   2. From your tickets and messages — SegmentedControl All · From CDS · From you (the page
//      owns `?from=` through `onFilter`), then rows: type icon 16 · middle-truncated name +
//      "In ticket #1042" / "In Messages" · CDS / You · date · size · Download icon button.
//      A tenant file still being scanned shows the `checking` badge and an aria-disabled
//      download with the reason (P12-P3).
// Newest first as given (server sorts). 50 rows per section, then ghost Show more.
// Links are minted on click: `onDownload(id)` (the page's server action) resolves to a
// 15-minute path and this sets window.location; no download href ever sits in the markup
// (T-12-11-02). Every cell is React text (T-12-11-01).
// A thrown request (network drop, a 500) shows an error alert above the lists, and the
// running Download shows its spinner and its row is aria-busy; others wait for it. It is
// never `disabled`, which would drop keyboard focus to <body> (12-REVIEW IN-D01).
import { formatFileSize } from "@cds/core/forms";
import type { CdsDocument, ThreadFile } from "@cds/core/support";
import { Download, FileText, Image as ImageIcon, Loader2 } from "lucide-react";
import { useId, useState } from "react";
import type { HubLinkComponent } from "../../AddonCard";
import { Badge } from "../../Badge";
import { Button } from "../../Button";
import { CdsMark } from "../../cds";
import { InlineAlert } from "../../feedback";
import { IconButton } from "../../IconButton";
import { SegmentedControl } from "../../SegmentedControl";
import { formatDayMonth } from "../../today/copy";
import { SUPPORT_UI_COPY } from "../copy";
import { THREAD_COPY, attachmentReady } from "../thread";
import { ticketHref } from "../tickets";

export type DocumentFrom = "all" | "cds" | "you";

export const DOCS_PAGE = 50;
export const MESSAGES_HREF = "/hub/support?tab=messages";

export const DOCS_COPY = Object.freeze({
  sharedHeading: "Shared by CDS",
  filesHeading: "From your tickets and messages",
  filterLabel: "Show files",
  filter: Object.freeze({ all: "All", cds: "From CDS", you: "From you" }),
  unread: "New",
  inTicket: "In ticket",
  inMessages: "In Messages",
  byCds: "CDS",
  byYou: "You",
  fromCds: "From CDS",
  filesEmpty: "No files in your tickets or messages yet.",
  filterEmpty: (from: "cds" | "you") =>
    `No files from ${from === "cds" ? "CDS" : "you"} yet.`,
});

/** "PDF", "PNG", "XLSX": from the file name's extension, else the mime subtype. */
export function fileTypeLabel(filename: string, mime: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot > 0 && dot < filename.length - 1) {
    return filename.slice(dot + 1).toUpperCase();
  }
  const sub = mime.split("/")[1] ?? "";
  return sub ? sub.toUpperCase() : "File";
}

export function filterThreadFiles(
  files: readonly ThreadFile[],
  from: DocumentFrom,
): ThreadFile[] {
  if (from === "all") return [...files];
  return files.filter((f) =>
    from === "cds" ? f.authorKind === "staff" : f.authorKind === "member",
  );
}

function middleTruncate(name: string, max = 48): string {
  if (name.length <= max) return name;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  return `${name.slice(0, head)}…${name.slice(name.length - (keep - head))}`;
}

function defaultNavigate(path: string): void {
  window.location.assign(path);
}

const LINK =
  "rounded underline underline-offset-2 hover:text-hub-ink focus-visible:outline-2 " +
  "focus-visible:outline-offset-2";

export interface DocumentListProps {
  cdsDocs: readonly CdsDocument[];
  files: readonly ThreadFile[];
  /** `?from=` link-state. */
  from: DocumentFrom;
  /** Mints the 15-minute link for a document or file id; resolves to its path (null = none). */
  onDownload(id: string): Promise<string | null>;
  onFilter(from: DocumentFrom): void;
  /** Business time zone for "9 Oct". */
  timeZone: string;
  /** Ids of CDS documents this person hasn't opened ("New"). */
  unreadIds?: readonly string[];
  LinkComponent?: HubLinkComponent;
  /** Where to send the browser once a link is minted (tests inject; default location.assign). */
  navigate?(path: string): void;
}

function useDownload(
  onDownload: DocumentListProps["onDownload"],
  navigate: (path: string) => void,
) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  async function run(id: string) {
    if (busy) return;
    setBusy(id);
    setFailed(false);
    try {
      const path = await onDownload(id);
      if (path) navigate(path);
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }
  return { busy, failed, run };
}

function DownloadIcon({ busy }: { busy: boolean }) {
  return busy ? (
    <Loader2
      aria-hidden
      size={16}
      strokeWidth={2}
      className="animate-spin motion-reduce:animate-none"
    />
  ) : (
    <Download aria-hidden size={16} strokeWidth={2} />
  );
}

function SharedRow({
  d,
  unread,
  timeZone,
  busy,
  onClick,
}: {
  d: CdsDocument;
  unread: boolean;
  timeZone: string;
  busy: boolean;
  onClick(): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const type = fileTypeLabel(d.filename, d.mime);
  const size = formatFileSize(d.size);
  const day = formatDayMonth(d.created, timeZone);
  const long = d.note.length > 140;
  const Icon = d.mime.startsWith("image/") ? ImageIcon : FileText;
  return (
    <li
      data-doc={d.id}
      aria-busy={busy || undefined}
      className="flex min-h-[72px] items-start gap-3 py-4"
    >
      <Icon
        aria-hidden
        size={20}
        strokeWidth={2}
        className="mt-0.5 shrink-0 text-hub-ink-muted"
      />
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold break-words text-hub-ink">
          {d.title}
          {unread ? (
            <Badge tone="unread" className="ml-2 align-middle">
              {DOCS_COPY.unread}
            </Badge>
          ) : null}
        </p>
        {d.note ? (
          <p
            className={
              "max-w-[68ch] text-base break-words text-hub-ink-muted" +
              (expanded ? "" : " line-clamp-2")
            }
          >
            {d.note}
          </p>
        ) : null}
        {long ? (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className={`text-sm text-hub-ink-muted ${LINK}`}
          >
            {SUPPORT_UI_COPY.BUTTONS.showMore}
          </button>
        ) : null}
        <p className="mt-1 flex items-center gap-1.5 text-sm text-hub-ink-muted">
          <CdsMark size={16} />
          {[DOCS_COPY.fromCds, day, size].filter(Boolean).join(" · ")}
        </p>
      </div>
      <Button
        size="sm"
        variant="secondary"
        icon={<DownloadIcon busy={busy} />}
        aria-label={`${SUPPORT_UI_COPY.BUTTONS.download} ${d.title}, ${type}, ${size}`}
        onClick={onClick}
        className="shrink-0"
      >
        {SUPPORT_UI_COPY.BUTTONS.download}
      </Button>
    </li>
  );
}

function FileRow({
  f,
  timeZone,
  Link,
  busy,
  onClick,
}: {
  f: ThreadFile;
  timeZone: string;
  Link: HubLinkComponent | "a";
  busy: boolean;
  onClick(): void;
}) {
  const reasonId = useId();
  const ready = attachmentReady(f);
  const Icon = f.mime.startsWith("image/") ? ImageIcon : FileText;
  const tail = [
    f.authorKind === "staff" ? DOCS_COPY.byCds : DOCS_COPY.byYou,
    formatDayMonth(f.created, timeZone),
    formatFileSize(f.size),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li data-file={f.id} className="flex min-h-[72px] items-center gap-3 py-4">
      <Icon
        aria-hidden
        size={16}
        strokeWidth={2}
        className="shrink-0 text-hub-ink-muted"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-base text-hub-ink" title={f.name}>
          {middleTruncate(f.name)}
          {ready ? null : (
            <Badge tone="checking" className="ml-2 align-middle">
              {THREAD_COPY.checking}
            </Badge>
          )}
        </p>
        <p className="text-sm text-hub-ink-muted">
          {f.ticketNumber !== null ? (
            <>
              {DOCS_COPY.inTicket}{" "}
              <Link href={ticketHref(f.ticketNumber)} className={LINK}>
                {`#${f.ticketNumber}`}
              </Link>
            </>
          ) : (
            <Link href={MESSAGES_HREF} className={LINK}>
              {DOCS_COPY.inMessages}
            </Link>
          )}
          {tail ? ` · ${tail}` : null}
        </p>
      </div>
      <IconButton
        size="sm"
        label={`${SUPPORT_UI_COPY.BUTTONS.download} ${f.name}`}
        icon={<DownloadIcon busy={busy} />}
        tooltipAlign="end"
        aria-busy={busy || undefined}
        aria-disabled={ready && !busy ? undefined : true}
        aria-describedby={ready ? undefined : reasonId}
        onClick={() => {
          if (ready) onClick();
        }}
      />
      {ready ? null : (
        <span id={reasonId} className="sr-only">
          {THREAD_COPY.checkingReason}
        </span>
      )}
    </li>
  );
}

function ShowMore({ onClick }: { onClick(): void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} className="mt-2">
      {SUPPORT_UI_COPY.BUTTONS.showMore}
    </Button>
  );
}

export function DocumentList({
  cdsDocs,
  files,
  from,
  onDownload,
  onFilter,
  timeZone,
  unreadIds = [],
  LinkComponent,
  navigate = defaultNavigate,
}: DocumentListProps) {
  const Link = LinkComponent ?? "a";
  const sharedId = useId();
  const filesId = useId();
  const [docLimit, setDocLimit] = useState(DOCS_PAGE);
  const [fileLimit, setFileLimit] = useState(DOCS_PAGE);
  const { busy, failed, run } = useDownload(onDownload, navigate);
  const shown = filterThreadFiles(files, from);

  return (
    <div className="flex flex-col gap-8 font-hub lg:gap-12">
      {failed ? (
        <InlineAlert tone="error">{THREAD_COPY.downloadFailed}</InlineAlert>
      ) : null}
      <section aria-labelledby={sharedId} data-cds-identity="">
        <h2
          id={sharedId}
          className="text-xl leading-tight font-semibold text-hub-ink"
        >
          {DOCS_COPY.sharedHeading}
        </h2>
        {cdsDocs.length === 0 ? (
          <p className="mt-2 text-base text-hub-ink-muted">
            {SUPPORT_UI_COPY.DOCS_EMPTY}
          </p>
        ) : (
          <>
            <ul className="mt-2 divide-y divide-hub-border">
              {cdsDocs.slice(0, docLimit).map((d) => (
                <SharedRow
                  key={d.id}
                  d={d}
                  unread={unreadIds.includes(d.id)}
                  timeZone={timeZone}
                  busy={busy === d.id}
                  onClick={() => void run(d.id)}
                />
              ))}
            </ul>
            {cdsDocs.length > docLimit ? (
              <ShowMore onClick={() => setDocLimit((n) => n + DOCS_PAGE)} />
            ) : null}
          </>
        )}
      </section>

      <section aria-labelledby={filesId}>
        <h2
          id={filesId}
          className="text-xl leading-tight font-semibold text-hub-ink"
        >
          {DOCS_COPY.filesHeading}
        </h2>
        {files.length === 0 ? (
          <p className="mt-2 text-base text-hub-ink-muted">
            {DOCS_COPY.filesEmpty}
          </p>
        ) : (
          <>
            <div className="mt-3 w-fit">
              <SegmentedControl<DocumentFrom>
                name="documents-from"
                label={DOCS_COPY.filterLabel}
                options={[
                  { value: "all", label: DOCS_COPY.filter.all },
                  { value: "cds", label: DOCS_COPY.filter.cds },
                  { value: "you", label: DOCS_COPY.filter.you },
                ]}
                value={from}
                onChange={(v) => {
                  setFileLimit(DOCS_PAGE);
                  onFilter(v);
                }}
              />
            </div>
            {shown.length === 0 && from !== "all" ? (
              <p className="mt-3 text-base text-hub-ink-muted">
                {DOCS_COPY.filterEmpty(from)}
              </p>
            ) : (
              <>
                <ul className="mt-2 divide-y divide-hub-border">
                  {shown.slice(0, fileLimit).map((f) => (
                    <FileRow
                      key={f.id}
                      f={f}
                      timeZone={timeZone}
                      Link={Link}
                      busy={busy === f.id}
                      onClick={() => void run(f.id)}
                    />
                  ))}
                </ul>
                {shown.length > fileLimit ? (
                  <ShowMore
                    onClick={() => setFileLimit((n) => n + DOCS_PAGE)}
                  />
                ) : null}
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}

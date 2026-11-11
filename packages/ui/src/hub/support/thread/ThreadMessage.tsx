"use client";
// ThreadMessage (12-09 choices 1, 2, 5; COMM-01, COMM-05; 12-UI-SPEC lines 303-311, 830).
// One full-width row of the record (no chat bubbles, no edit, no delete, no reactions):
//   - CDS-authored (`authorKind: "staff"`): a CdsSurface (data-cds-identity) with
//     CdsAuthor ("Mara · CDS", sr "Mara from CDS") and the clock time.
//   - Tenant-authored: hub surface, 1px border, 8px radius, the member's name ("You" for the
//     viewer) in Label 600 and the time.
// Identity comes from `authorKind` in the server projection only, never from the name text
// (T-12-09-02). The body is plain text with auto-linked http(s) URLs and kept line breaks,
// rendered as React text nodes (T-12-09-01). Each message is an <article> labelled by its
// author line ("Mara from CDS, 2:14 pm").
// 13-35 choice 1 (STAFF-08, D-UI-P13-8; 13-UI-SPEC "Internal note surface"): `variant="internal"`
// is the staff console's internal note: hatched warning ground (decorative; dropped in forced
// colours), 1px dashed `--hub-warning` border, 8px radius, header EyeOff + "Internal note" +
// INTERNAL_LINE + author + time. Staff only: the hub never passes it (the repository already
// keeps internal notes out of every tenant read, P12; T-13-35-01). The default variant is
// unchanged.
import { P13_COPY } from "@cds/core/staff";
import type { TenantAttachment, TenantMessage } from "@cds/core/support";
import { EyeOff } from "lucide-react";
import { useId, type CSSProperties } from "react";
import { CdsAuthor, CdsSurface } from "../../cds";
import { AttachmentList } from "./AttachmentList";
import { autolinkTokens } from "./autolink";
import { clockTime, THREAD_COPY } from "./copy";

export interface MessageBodyProps {
  text: string;
  className?: string;
}

/** Plain text, http(s) links opening in a new tab, line breaks kept. Never HTML. */
export function MessageBody({ text, className }: MessageBodyProps) {
  const tokens = autolinkTokens(text);
  return (
    <p
      data-message-body=""
      className={
        "max-w-[68ch] font-hub text-base break-words whitespace-pre-wrap text-hub-ink" +
        (className ? ` ${className}` : "")
      }
    >
      {tokens.map((t, i) =>
        t.kind === "url" ? (
          <a
            key={i}
            href={t.href}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-hub-accent underline underline-offset-2"
          >
            {t.text}
            <span className="sr-only"> {THREAD_COPY.newTab}</span>
          </a>
        ) : (
          <span key={i}>{t.text}</span>
        ),
      )}
    </p>
  );
}

export interface ThreadMessageProps {
  message: TenantMessage;
  timeZone: string;
  /** The viewer wrote it: their name shows as "You". */
  own?: boolean;
  onDownload(fileId: string): void | Promise<void>;
  previewSrc?(attachment: TenantAttachment): string | null;
  /** `internal`: the staff console's internal note surface (staff only; never the hub). */
  variant?: "default" | "internal";
}

/**
 * UI-SPEC "Internal note surface" ground (decorative hatch), set as a CSS variable so the
 * forced-colors class can drop it (the dashed border and the words remain).
 */
export const INTERNAL_HATCH = Object.freeze({
  "--hub-internal-hatch":
    "repeating-linear-gradient(135deg, var(--hub-warning-tint) 0 8px, " +
    "color-mix(in srgb, var(--hub-warning) 8%, var(--hub-warning-tint)) 8px 16px)",
}) as CSSProperties;

/** Header words of an internal note. */
export const INTERNAL_NOTE_LABEL = "Internal note";

function staffFirstName(name: string): string | undefined {
  const n = name.trim();
  return n && n !== "CDS" ? n : undefined;
}

export function ThreadMessage({
  message: m,
  timeZone,
  own = false,
  onDownload,
  previewSrc,
  variant = "default",
}: ThreadMessageProps) {
  const labelId = useId();
  const time = clockTime(m.created, timeZone);
  const isCds = m.authorKind === "staff";
  const content = (
    <>
      {m.body ? <MessageBody text={m.body} className="mt-2" /> : null}
      <AttachmentList
        attachments={m.attachments}
        onDownload={onDownload}
        previewSrc={previewSrc}
        className="mt-2"
      />
    </>
  );

  if (variant === "internal") {
    const author = m.authorName.trim() || "Support";
    return (
      <article
        aria-labelledby={labelId}
        data-message={m.id}
        data-author-kind={m.authorKind}
        data-internal=""
        style={INTERNAL_HATCH}
        className="rounded-lg border border-dashed border-hub-warning bg-(image:--hub-internal-hatch) p-4 text-hub-ink forced-colors:bg-none"
      >
        <p
          id={labelId}
          className="flex flex-wrap items-center gap-x-2 gap-y-1 font-hub text-sm"
        >
          <EyeOff aria-hidden size={16} strokeWidth={2} className="shrink-0" />
          <span className="font-semibold text-hub-ink">
            {INTERNAL_NOTE_LABEL}
          </span>
          <span className="text-hub-ink-muted">
            {"· "}
            {P13_COPY.INTERNAL_LINE}
          </span>
          <span className="font-semibold text-hub-ink">{author}</span>
          <span className="sr-only">, </span>
          <time dateTime={m.created} className="text-hub-ink-muted">
            {time}
          </time>
        </p>
        {content}
      </article>
    );
  }

  if (isCds) {
    const first = staffFirstName(m.authorName);
    return (
      <CdsSurface
        as="article"
        aria-labelledby={labelId}
        data-message={m.id}
        data-author-kind="staff"
      >
        <p id={labelId} className="flex flex-wrap items-center gap-2 text-sm">
          <CdsAuthor firstName={first} />
          {first ? null : <span className="sr-only">from Support</span>}
          <span className="sr-only">, </span>
          <time
            dateTime={m.created}
            className="font-hub text-sm text-hub-ink-muted"
          >
            {time}
          </time>
        </p>
        {content}
      </CdsSurface>
    );
  }

  const name = own ? THREAD_COPY.you : m.authorName.trim() || THREAD_COPY.you;
  return (
    <article
      aria-labelledby={labelId}
      data-message={m.id}
      data-author-kind="member"
      className="rounded-lg border border-hub-border bg-hub-surface p-4 text-hub-ink"
    >
      <p
        id={labelId}
        className="flex flex-wrap items-center gap-2 font-hub text-sm"
      >
        <span className="font-semibold text-hub-ink">{name}</span>
        <span className="sr-only">, </span>
        <time dateTime={m.created} className="text-hub-ink-muted">
          {time}
        </time>
      </p>
      {content}
    </article>
  );
}

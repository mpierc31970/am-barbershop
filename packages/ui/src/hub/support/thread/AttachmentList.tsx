"use client";
// AttachmentList / AttachmentChip (12-09; COMM-08; 12-UI-SPEC "Thread anatomy" lines
// 325-332, a11y 846). Files on one message:
//   - Clean (or staff) images, when the page passes `previewSrc`, are 64px thumbnail buttons
//     "Open {name}" that open a Dialog preview (alt = file name) with Download.
//   - Everything else is a chip: type icon 16 + middle-truncated name + size + Download.
//   - A tenant file still being scanned (`scan: "pending"`, P12-P3) shows the `checking`
//     badge, no thumbnail, and an aria-disabled Download whose reason is in
//     aria-describedby. Staff files need no scan.
// Downloads mint the 15-minute signed link on click through `onDownload(fileId)` (the page's
// server action); links never sit in the page (D-UI-P12-14). A download that throws (network
// drop, a 500) shows THREAD_COPY.downloadFailed as an alert instead of an unhandled
// rejection (12-REVIEW IN-D01).
import { formatFileSize } from "@cds/core/forms";
import type { TenantAttachment } from "@cds/core/support";
import { Download, FileText, Image as ImageIcon } from "lucide-react";
import { useId, useState } from "react";
import { Badge } from "../../Badge";
import { Button } from "../../Button";
import { Dialog } from "../../Dialog";
import { IconButton } from "../../IconButton";
import { InlineAlert } from "../../feedback";
import { SUPPORT_UI_COPY } from "../copy";
import { THREAD_COPY } from "./copy";

export interface AttachmentListProps {
  attachments: readonly TenantAttachment[];
  onDownload(fileId: string): void | Promise<void>;
  /** A same-origin preview URL for a clean image, or null for a chip. */
  previewSrc?(attachment: TenantAttachment): string | null;
  className?: string;
}

/** A tenant upload is downloadable once scanned clean; staff files never wait (P12-P3). */
export function attachmentReady(a: TenantAttachment): boolean {
  return a.scan === "clean" || a.scan === "staff";
}

/** Runs a download and reports a throw (sync or async) through `onFailed`. */
function runDownload(
  onDownload: (fileId: string) => void | Promise<void>,
  fileId: string,
  onFailed: () => void,
): void {
  try {
    const pending = onDownload(fileId);
    if (pending) pending.catch(onFailed);
  } catch {
    onFailed();
  }
}

function middleTruncate(name: string, max = 40): string {
  if (name.length <= max) return name;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  return `${name.slice(0, head)}…${name.slice(name.length - (keep - head))}`;
}

export interface AttachmentChipProps {
  attachment: TenantAttachment;
  onDownload(fileId: string): void | Promise<void>;
  /** A thrown download. Without it the chip announces the failure itself. */
  onError?(): void;
}

export function AttachmentChip({
  attachment: a,
  onDownload,
  onError,
}: AttachmentChipProps) {
  const reasonId = useId();
  const [failed, setFailed] = useState(false);
  const ready = attachmentReady(a);
  const Icon = a.mime.startsWith("image/") ? ImageIcon : FileText;
  return (
    <li
      data-attachment={a.id}
      className={
        "flex max-w-full min-w-0 items-center gap-2 rounded border border-hub-border " +
        "bg-hub-surface py-1 pr-1 pl-3 font-hub text-hub-ink"
      }
    >
      <Icon aria-hidden size={16} strokeWidth={2} className="shrink-0" />
      <span className="min-w-0 truncate text-base" title={a.name}>
        {middleTruncate(a.name)}
      </span>
      <span className="shrink-0 text-sm text-hub-ink-muted tabular-nums">
        {formatFileSize(a.size)}
      </span>
      {ready ? null : <Badge tone="checking">{THREAD_COPY.checking}</Badge>}
      <IconButton
        size="sm"
        label={`${SUPPORT_UI_COPY.BUTTONS.download} ${a.name}`}
        icon={<Download aria-hidden size={16} strokeWidth={2} />}
        tooltipAlign="end"
        aria-disabled={ready ? undefined : true}
        aria-describedby={ready ? undefined : reasonId}
        onClick={() => {
          if (!ready) return;
          setFailed(false);
          runDownload(onDownload, a.id, () =>
            onError ? onError() : setFailed(true),
          );
        }}
      />
      {failed ? (
        <span role="alert" className="text-sm text-hub-ink">
          {THREAD_COPY.downloadFailed}
        </span>
      ) : null}
      {ready ? null : (
        <span id={reasonId} className="sr-only">
          {THREAD_COPY.checkingReason}
        </span>
      )}
    </li>
  );
}

export function AttachmentList({
  attachments,
  onDownload,
  previewSrc,
  className,
}: AttachmentListProps) {
  const [open, setOpen] = useState<{ a: TenantAttachment; src: string } | null>(
    null,
  );
  const [failed, setFailed] = useState(false);
  const download = (fileId: string) => {
    setFailed(false);
    runDownload(onDownload, fileId, () => setFailed(true));
  };
  if (attachments.length === 0) return null;
  const thumbs: { a: TenantAttachment; src: string }[] = [];
  const chips: TenantAttachment[] = [];
  for (const a of attachments) {
    const src =
      attachmentReady(a) && a.mime.startsWith("image/") && previewSrc
        ? previewSrc(a)
        : null;
    if (src) thumbs.push({ a, src });
    else chips.push(a);
  }
  return (
    <div className={`flex flex-col gap-2${className ? ` ${className}` : ""}`}>
      {thumbs.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {thumbs.map(({ a, src }) => (
            <li key={a.id}>
              <button
                type="button"
                aria-label={`Open ${a.name}`}
                onClick={() => setOpen({ a, src })}
                className="block h-16 w-16 overflow-hidden rounded border border-hub-border"
              >
                <img
                  src={src}
                  alt=""
                  width={64}
                  height={64}
                  className="h-16 w-16 rounded object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {chips.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {chips.map((a) => (
            <AttachmentChip
              key={a.id}
              attachment={a}
              onDownload={download}
              onError={() => setFailed(true)}
            />
          ))}
        </ul>
      ) : null}
      {failed && !open ? (
        <InlineAlert tone="error">{THREAD_COPY.downloadFailed}</InlineAlert>
      ) : null}
      <Dialog
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open?.a.name ?? ""}
        footer={
          open ? (
            <Button
              variant="secondary"
              icon={<Download aria-hidden size={16} strokeWidth={2} />}
              onClick={() => download(open.a.id)}
            >
              {SUPPORT_UI_COPY.BUTTONS.download}
            </Button>
          ) : null
        }
      >
        {open && failed ? (
          <InlineAlert tone="error">{THREAD_COPY.downloadFailed}</InlineAlert>
        ) : null}
        {open ? (
          <img
            src={open.src}
            alt={open.a.name}
            className="h-auto max-w-full rounded"
          />
        ) : null}
      </Dialog>
    </div>
  );
}

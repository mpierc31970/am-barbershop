"use client";
// MediaDropZone and MediaUploadButton (07-17; CONT-19, D-UI-P7-9; 07-UI-SPEC "Media" header,
// EMPTY-MEDIA, P5 FileDrop look). The drop zone wraps a real, labelled file input (the keyboard
// and screen-reader path); dragging over shows the 2px dashed accent border. The header's
// Upload files is a label-wrapped file input styled as the primary ("Choose files" below
// 768px); at 100% of the allowance it is replaced by the USAGE-FULL sentence (no button).
import { Upload } from "lucide-react";
import { useId, useState, type DragEvent } from "react";
import { buttonClasses } from "./Button";
import { MEDIA_ACCEPT, MEDIA_COPY, type UsageView } from "./media/copy";

export interface MediaDropZoneProps {
  onFiles(files: File[]): void;
  accept?: string;
  disabled?: boolean;
  /** 96px high (the drawer's captions drop). */
  compact?: boolean;
  multiple?: boolean;
  /** The words before the link. Default "Drop files here, or". */
  prompt?: string;
  /** The link words. Default "choose files". */
  chooseLabel?: string;
  /**
   * 07-22 (additive): when set, the link words are a button that calls this (e.g. open the
   * media picker, whose Upload tab is the keyboard upload path) instead of a file input.
   */
  onChoose?: () => void;
}

const FOCUS_WITHIN =
  "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-hub-accent";

export function MediaDropZone({
  onFiles,
  accept = MEDIA_ACCEPT,
  disabled = false,
  compact = false,
  multiple = true,
  prompt = "Drop files here, or",
  chooseLabel = "choose files",
  onChoose,
}: MediaDropZoneProps) {
  const inputId = useId();
  const [over, setOver] = useState(false);

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
    if (disabled) return;
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0) onFiles(multiple ? files : files.slice(0, 1));
  }

  return (
    <div
      data-media-drop=""
      data-over={over || undefined}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={
        `flex ${compact ? "min-h-24 p-4" : "min-h-40 p-6"} flex-col items-center justify-center ` +
        "gap-2 rounded text-center font-hub text-base text-hub-ink transition-colors duration-150 " +
        "motion-reduce:transition-none " +
        (over
          ? "border-2 border-dashed border-hub-accent bg-hub-accent-tint"
          : "border border-dashed border-hub-border-strong bg-hub-surface-2") +
        (disabled ? " opacity-50" : "")
      }
    >
      <Upload aria-hidden size={20} strokeWidth={2} />
      <p>
        {prompt}{" "}
        {onChoose ? (
          <button
            type="button"
            disabled={disabled}
            onClick={onChoose}
            className="cursor-pointer rounded text-hub-accent underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent disabled:cursor-not-allowed"
          >
            {chooseLabel}
          </button>
        ) : (
          <label
            htmlFor={inputId}
            className={`cursor-pointer rounded text-hub-accent underline underline-offset-2 ${FOCUS_WITHIN}`}
          >
            {chooseLabel}
            <input
              id={inputId}
              type="file"
              multiple={multiple}
              accept={accept}
              disabled={disabled}
              className="sr-only"
              onChange={(e) => {
                const files = Array.from(e.currentTarget.files ?? []);
                e.currentTarget.value = "";
                if (files.length > 0) onFiles(files);
              }}
            />
          </label>
        )}
      </p>
    </div>
  );
}

export interface MediaUploadButtonProps {
  usage: UsageView | null;
  onFiles(files: File[]): void;
  disabled?: boolean;
  accept?: string;
}

/** The view's one primary (Upload files), or USAGE-FULL at 100% (D-UI-P7-9). */
export function MediaUploadButton({
  usage,
  onFiles,
  disabled = false,
  accept = MEDIA_ACCEPT,
}: MediaUploadButtonProps) {
  const inputId = useId();
  if (usage?.level === "full") {
    return (
      <p
        data-usage-full=""
        className="max-w-[360px] font-hub text-sm text-hub-ink-muted"
      >
        {usage.message || MEDIA_COPY.usageFull}
      </p>
    );
  }
  return (
    <label
      htmlFor={inputId}
      data-upload-button=""
      className={`${buttonClasses("primary", "md")} cursor-pointer ${FOCUS_WITHIN} ${disabled ? "pointer-events-none opacity-50" : ""}`}
    >
      <Upload aria-hidden size={16} strokeWidth={2} />
      <span className="hidden md:inline">{MEDIA_COPY.uploadFiles}</span>
      <span className="md:hidden">{MEDIA_COPY.chooseFiles}</span>
      <input
        id={inputId}
        type="file"
        multiple
        accept={accept}
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = "";
          if (files.length > 0) onFiles(files);
        }}
      />
    </label>
  );
}

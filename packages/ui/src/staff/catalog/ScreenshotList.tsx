"use client";
// ScreenshotList (13-37 choice 2; STAFF-07, P13-P21; 13-UI-SPEC "Catalog" ListingEditor). The
// listing's screenshots in display order: 160 × 100 thumbnails, each with a required Alt text
// field and Move up / Move down / Remove ghost icon buttons (keyboard-safe; no drag at ≤ 6).
// Adding one: Choose image (PNG, JPEG or WebP, ≤ 2 MB, checked here and again by content on
// the server), then Alt text, then Upload; at 6 the add control explains why it is gone.
// Controlled: reorder and alt edits go to `onChange` (saved with Save listing); `onUpload`
// posts the file (the route handler, not a Server Action: the 2 MB body cap) and `onRemove`
// is the caller's immediate remove with Undo.
import { P13_COPY } from "@cds/core/staff";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../../hub/Button";
import { InlineAlert } from "../../hub/feedback";
import { TextField } from "../../hub/fields";
import { IconButton } from "../../hub/IconButton";
import { rethrowControlFlow, type StaffActionResult } from "../dialogs";
import { CATALOG_COPY as C } from "./copy";

export interface ScreenshotItem {
  id: string;
  url: string;
  alt: string;
  w: number;
  h: number;
}

export interface ScreenshotListProps {
  items: readonly ScreenshotItem[];
  onChange: (items: ScreenshotItem[]) => void;
  /**
   * WR-E14: a finished upload adds its item through this (a functional update in the parent),
   * so alt or order edits made during the upload are kept. Without it, the newest items seen
   * at render time are used.
   */
  onAppend?: (item: ScreenshotItem) => void;
  onUpload: (
    file: File,
    alt: string,
  ) => Promise<StaffActionResult<ScreenshotItem>>;
  onRemove: (id: string) => void;
  max?: number;
  maxBytes?: number;
  altMax?: number;
  disabled?: boolean;
}

const TYPES = ["image/png", "image/jpeg", "image/webp"];

function move<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

export function ScreenshotList({
  items,
  onChange,
  onAppend,
  onUpload,
  onRemove,
  max = 6,
  maxBytes = 2 * 1024 * 1024,
  altMax = 200,
  disabled = false,
}: ScreenshotListProps) {
  const base = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const full = items.length >= max;
  const latest = useRef(items);
  useEffect(() => {
    latest.current = items;
  });

  function pick(f: File | undefined) {
    setError(null);
    if (!f) return;
    if (!TYPES.includes(f.type)) {
      setError(C.wrongType);
      return;
    }
    if (f.size > maxBytes) {
      setError(C.tooBig);
      return;
    }
    setFile(f);
  }

  function reset() {
    setFile(null);
    setAlt("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function upload() {
    if (!file || alt.trim() === "" || pending) return;
    setPending(true);
    setError(null);
    try {
      const r = await onUpload(file, alt.trim());
      if (r.ok) {
        if (onAppend) onAppend(r.data);
        else onChange([...latest.current, r.data]);
        reset();
      } else if (r.code !== "step_up_needed" && r.code !== "session_ended") {
        setError(r.message);
      }
    } catch (err) {
      rethrowControlFlow(err);
      setError(P13_COPY.ERR_SEND);
    } finally {
      setPending(false);
    }
  }

  return (
    <fieldset className="flex flex-col gap-3 font-hub text-hub-ink">
      <legend className="text-sm font-semibold">{C.screenshots}</legend>
      <p className="text-sm text-hub-ink-muted">{C.screenshotsHelp(max)}</p>
      {items.length === 0 ? (
        <p className="text-sm text-hub-ink-muted">{C.noScreenshots}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {items.map((s, i) => (
            <li
              key={s.id}
              className="flex flex-col gap-3 rounded border border-hub-border p-3 sm:flex-row sm:items-start"
            >
              <img
                src={s.url}
                alt=""
                width={160}
                height={100}
                className="h-[100px] w-[160px] shrink-0 rounded border border-hub-border bg-hub-surface-2 object-cover"
              />
              <div className="min-w-0 flex-1">
                <TextField
                  id={`${base}-alt-${s.id}`}
                  label={C.altText}
                  value={s.alt}
                  maxLength={altMax}
                  required
                  disabled={disabled}
                  error={s.alt.trim() === "" ? C.altRequired : undefined}
                  onChange={(e) =>
                    onChange(
                      items.map((x) =>
                        x.id === s.id ? { ...x, alt: e.target.value } : x,
                      ),
                    )
                  }
                />
              </div>
              <div className="flex gap-1 sm:pt-7">
                <IconButton
                  label={C.moveShotUpLabel(i + 1)}
                  icon={<ArrowUp aria-hidden size={16} />}
                  size="sm"
                  disabled={disabled || i === 0}
                  onClick={() => onChange(move(items, i, i - 1))}
                />
                <IconButton
                  label={C.moveShotDownLabel(i + 1)}
                  icon={<ArrowDown aria-hidden size={16} />}
                  size="sm"
                  disabled={disabled || i === items.length - 1}
                  onClick={() => onChange(move(items, i, i + 1))}
                />
                <IconButton
                  label={C.removeLabel(i + 1)}
                  icon={<Trash2 aria-hidden size={16} />}
                  size="sm"
                  tooltipAlign="end"
                  disabled={disabled}
                  onClick={() => onRemove(s.id)}
                />
              </div>
            </li>
          ))}
        </ol>
      )}

      {full ? (
        <p className="text-sm text-hub-ink-muted">{C.full(max)}</p>
      ) : (
        <div className="flex flex-col gap-3 rounded border border-dashed border-hub-border-strong p-3">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              id={`${base}-file`}
              type="file"
              accept={TYPES.join(",")}
              className="sr-only"
              disabled={disabled || pending}
              onChange={(e) => pick(e.target.files?.[0])}
            />
            <label
              htmlFor={`${base}-file`}
              className="inline-flex min-h-10 cursor-pointer items-center rounded border border-hub-border-strong bg-hub-surface px-4 text-base font-semibold hover:bg-hub-surface-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-hub-accent"
            >
              {C.chooseImage}
            </label>
            {file ? (
              <span className="min-w-0 truncate text-sm text-hub-ink-muted">
                {file.name}
              </span>
            ) : null}
          </div>
          {file ? (
            <>
              <TextField
                id={`${base}-new-alt`}
                label={C.altText}
                value={alt}
                maxLength={altMax}
                required
                helper={C.altRequired}
                onChange={(e) => setAlt(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => void upload()}
                  disabled={alt.trim() === "" || pending}
                >
                  {pending ? C.uploading : C.upload}
                </Button>
                <Button variant="ghost" onClick={reset} disabled={pending}>
                  {C.cancel}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      )}
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
    </fieldset>
  );
}

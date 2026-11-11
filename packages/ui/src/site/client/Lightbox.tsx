"use client";
// Lightbox island (07-22; CONT-22; 07-UI-SPEC "Lightbox" lines 543-544, labels line 648,
// a11y line 680, motion lines 692-693; 07-22 decision 9).
//
// Wraps the server-rendered photo list and delegates clicks from its
// `[data-gallery-photo]` buttons (data-index = position in `photos`). Opens a native
// <dialog aria-label="Photo viewer">; focus via useOverlay; no new trap (useOverlay owns
// the trap, Esc, scroll lock and focus return to the clicked photo button).
// The dialog <img> mounts only while open (srcSet + sizes="100vw"), so the large variants
// load on open and never before. Previous/Next stop at the ends of the current page:
// they turn aria-disabled (not `disabled`, so keyboard focus never drops out of the dialog).
// ArrowLeft/ArrowRight and a horizontal swipe over 40px step too. Open is a 200ms fade +
// 0.98 -> 1 scale; reduced motion opens instantly. Theme roles only; React text only.
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { useOverlay } from "./useOverlay";

export interface LightboxPhoto {
  src: string;
  srcSet?: string;
  width?: number;
  height?: number;
  alt: string;
  caption: string;
  /** 1-based position across the whole gallery (the counter). */
  position: number;
}

export interface LightboxProps {
  photos: readonly LightboxPhoto[];
  total: number;
  children: ReactNode;
}

const REDUCED = "(prefers-reduced-motion: reduce)";
const SWIPE_MIN_PX = 40;
const MOTION =
  "transition-[opacity,scale] duration-200 ease-out-expo starting:opacity-0 starting:scale-98 " +
  "motion-reduce:transition-none motion-reduce:starting:scale-100";
const CONTROL =
  "inline-flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-site-button " +
  "border border-site-text bg-transparent text-site-text transition-colors duration-150 " +
  "hover:bg-site-surface-raised aria-disabled:cursor-default aria-disabled:opacity-40 " +
  "aria-disabled:hover:bg-transparent focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-[var(--site-focus)]";

function prefersReduced(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED).matches
  );
}

export function Lightbox({ photos, total, children }: LightboxProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [reduced, setReduced] = useState(false);

  const onClose = useCallback(() => setOpen(false), []);
  useOverlay(dialogRef, { isOpen: open, onClose, returnFocusRef: openerRef });

  const last = photos.length - 1;
  const step = (delta: number) =>
    setIndex((i) => Math.min(last, Math.max(0, i + delta)));

  const onOpenerClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target instanceof Element ? e.target : null;
    const opener = target?.closest<HTMLElement>("[data-gallery-photo]");
    if (!opener || !e.currentTarget.contains(opener)) return;
    const i = Number(opener.dataset.index);
    if (!Number.isInteger(i) || i < 0 || i > last) return;
    openerRef.current = opener;
    setReduced(prefersReduced());
    setIndex(i);
    setOpen(true);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      step(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      step(-1);
    }
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    pointer.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const start = pointer.current;
    pointer.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) > SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy)) {
      step(dx < 0 ? 1 : -1);
    }
  };

  const photo = open ? photos[index] : undefined;
  const atStart = index <= 0;
  const atEnd = index >= last;

  return (
    <>
      <div onClick={onOpenerClick}>{children}</div>
      <dialog
        ref={dialogRef}
        aria-label="Photo viewer"
        onKeyDown={onKeyDown}
        className={
          "fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden border-0 " +
          "bg-site-surface p-0 text-site-text backdrop:bg-site-surface " +
          (reduced ? "" : MOTION)
        }
      >
        {photo ? (
          <div className="flex h-full flex-col">
            <div className="flex justify-end p-4">
              <button
                type="button"
                data-cds-popup-close=""
                aria-label="Close photo"
                className={CONTROL}
              >
                <X size={24} aria-hidden="true" />
              </button>
            </div>
            <div
              data-lightbox-stage=""
              className="flex min-h-0 flex-1 touch-pan-y items-center justify-center px-4"
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
              onPointerCancel={() => (pointer.current = null)}
            >
              <img
                key={photo.src}
                src={photo.src}
                srcSet={photo.srcSet}
                sizes={photo.srcSet ? "100vw" : undefined}
                width={photo.width}
                height={photo.height}
                alt={photo.alt}
                decoding="async"
                draggable={false}
                className="block h-auto max-h-[calc(100vh-160px)] w-auto max-w-full select-none rounded-site-media object-contain"
              />
            </div>
            <div className="mx-auto flex w-full max-w-[1120px] flex-wrap items-center justify-between gap-4 px-4 py-4 md:px-8">
              <p className="min-w-0 flex-1 text-[length:var(--site-text-body)] leading-[1.6] text-site-text-muted">
                {photo.caption}
              </p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  aria-label="Previous photo"
                  aria-disabled={atStart ? "true" : undefined}
                  onClick={() => !atStart && step(-1)}
                  className={CONTROL}
                >
                  <ChevronLeft size={24} aria-hidden="true" />
                </button>
                <p
                  aria-live="polite"
                  className="min-w-16 text-center tabular-nums text-site-text-muted"
                >
                  {`${photo.position} of ${total}`}
                </p>
                <button
                  type="button"
                  aria-label="Next photo"
                  aria-disabled={atEnd ? "true" : undefined}
                  onClick={() => !atEnd && step(1)}
                  className={CONTROL}
                >
                  <ChevronRight size={24} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}

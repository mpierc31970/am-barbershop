"use client";
// Hub toasts (03-UI-SPEC "Interaction states", "Destructive actions"; donor
// UndoToast.tsx). ToastRegion is the provider and the one role="status" live region:
// bottom-right at 768px and up, bottom-center below. 6s by default, 8s when the toast
// carries an action (Undo), paused while hovered or focused, dismiss IconButton, at most
// 3 stacked (the oldest drops). Enter is a 200ms ease-out-expo fade/rise. A toast that
// closes while it holds keyboard focus (including one the cap drops) returns focus to
// where it came from.
import { X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { IconButton } from "./IconButton";

export const TOAST_MS = 6000;
export const UNDO_TOAST_MS = 8000;
export const MAX_TOASTS = 3;

export interface ToastInput {
  message: string;
  action?: { label: string; onClick: () => void };
  durationMs?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

/** Explicit duration wins; otherwise 8s with an action, 6s without. */
export function toastDuration(t: ToastInput): number {
  if (typeof t.durationMs === "number" && t.durationMs > 0) return t.durationMs;
  return t.action ? UNDO_TOAST_MS : TOAST_MS;
}

/** Append, keeping only the newest MAX_TOASTS. */
export function pushToast<T>(list: readonly T[], item: T): T[] {
  return [...list, item].slice(-MAX_TOASTS);
}

interface ToastApi {
  show: (t: ToastInput) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside <ToastRegion>");
  return api;
}

export function ToastRegion({ children }: { children?: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show: (t) => {
        const id = nextId.current++;
        setToasts((list) => pushToast(list, { ...t, id }));
      },
    }),
    [],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className={
          "pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-center gap-2 " +
          "md:inset-x-auto md:right-8 md:bottom-8 md:items-end"
        }
      >
        {toasts.map((t) => (
          <Toast key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: number) => void;
}) {
  // Hover and focus pause separately: one boolean let a mouse leaving the toast restart
  // the timer while keyboard focus was still on Undo (WR-C12).
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const paused = hovered || focusWithin;
  const remaining = useRef(toastDuration(toast));
  const rootRef = useRef<HTMLDivElement>(null);
  // Where focus was before it entered this toast; it goes back there on close.
  const returnTo = useRef<HTMLElement | null>(null);

  // Every way out (timer, Dismiss, Undo, and eviction by the 3-toast cap, which never
  // calls close) unmounts the toast, so the focus hand-back lives in a layout cleanup: it
  // runs before the node leaves the DOM, while it still holds focus (IN-R04). Focus goes
  // to where it came from; when that is unknown (F6 or a landmark jump gives no
  // relatedTarget) to whatever held focus when the toast appeared, then to #content.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const active = document.activeElement;
    const shownFrom =
      active instanceof HTMLElement && active !== document.body ? active : null;
    return () => {
      if (!root || !root.contains(document.activeElement)) return;
      const usable = (el: HTMLElement | null): el is HTMLElement =>
        el !== null && el.isConnected && !root.contains(el);
      const target = [
        returnTo.current,
        shownFrom,
        document.getElementById("content"),
      ].find(usable);
      target?.focus();
    };
  }, []);

  const close = useCallback(() => {
    onDismiss(toast.id);
  }, [onDismiss, toast.id]);

  // Count down only while not paused; pausing keeps the time left.
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = setTimeout(close, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(
        0,
        remaining.current - (Date.now() - started),
      );
    };
  }, [paused, close]);

  const inside = (node: EventTarget | null) =>
    node instanceof Node && rootRef.current?.contains(node) === true;

  return (
    <div
      ref={rootRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={(e) => {
        if (!inside(e.relatedTarget)) {
          returnTo.current =
            e.relatedTarget instanceof HTMLElement ? e.relatedTarget : null;
        }
        setFocusWithin(true);
      }}
      onBlur={(e) => {
        // Moving between Undo and Dismiss stays inside: no unpause flicker.
        if (!inside(e.relatedTarget)) setFocusWithin(false);
      }}
      className={
        "pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded bg-hub-ink " +
        "py-2 pr-2 pl-4 font-hub text-sm text-hub-surface shadow-lg " +
        "transition duration-200 ease-out-expo starting:translate-y-2 starting:opacity-0 " +
        "motion-reduce:starting:translate-y-0"
      }
    >
      <p className="min-w-0 flex-1">{toast.message}</p>
      {toast.action ? (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick();
            close();
          }}
          className={
            "h-8 shrink-0 rounded px-3 font-semibold text-hub-surface underline " +
            "underline-offset-2 transition-colors duration-150 hover:bg-hub-surface/10 " +
            "pointer-coarse:min-h-11"
          }
        >
          {toast.action.label}
        </button>
      ) : null}
      <IconButton
        label="Dismiss"
        size="sm"
        hideTooltip
        icon={<X aria-hidden size={16} strokeWidth={2} />}
        onClick={close}
        className="text-hub-surface hover:bg-hub-surface/10 hover:text-hub-surface"
      />
    </div>
  );
}

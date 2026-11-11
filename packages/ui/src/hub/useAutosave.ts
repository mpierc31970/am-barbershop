"use client";
// Autosave hook for setup steps (06-18; ONB-02, D-UI-P6-19; 06-UI-SPEC "Stages" autosave
// contract). A field calls run(value) on blur (text) or change (switches, radios, selects);
// the hook saves through the given server action and exposes one status for AutosaveStatus.
//   - debounceMs 0 (default) saves at once; typed-while-you-go fields pass e.g. 800.
//   - Never two saves in flight: a value arriving mid-save is queued, and later values fold
//     into the queued one (merge; default: the latest wins), so nothing is lost or reordered.
//   - An invalid_input refusal is "invalid" (the field shows the message and nothing was
//     saved); any other failure is "error", and retry() re-sends the failed value.
//   - A value waiting on the debounce is never dropped (B-WR-05): unmount (leaving the
//     stage), pagehide and the tab going hidden all save it at once, and a save queued
//     behind one in flight still goes out after unmount. flush() does the same on demand.
//   - 12-17 (COMM-11, D102): a `target_locked` refusal (a CDS service window) is never
//     retried. The refused value, with anything queued behind it folded in, goes to
//     onLocked once (the editor parks it as a held draft) and the status is "paused"
//     ("Editing paused"). With no onLocked, the pending change is kept as a failed save
//     ("error"; retry() re-sends it) so nothing is lost.
import { useCallback, useEffect, useRef, useState } from "react";
import type { HubActionResult } from "./addon-types";

export type AutosaveState =
  "idle" | "saving" | "saved" | "error" | "invalid" | "paused";

export type AutosaveFailure = { code: string; message: string; field?: string };

export interface AutosaveOptions<T> {
  debounceMs?: number;
  /** Folds a newer queued value into an older one (default: the newer replaces it). */
  merge?: (older: T, newer: T) => T;
  onSaved?: (data: unknown, value: T) => void;
  onFailed?: (failure: AutosaveFailure, value: T) => void;
  /**
   * 12-17: a save refused with `target_locked`. Receives the pending change (the refused
   * value with anything queued behind it folded in) once; nothing is retried.
   */
  onLocked?: (pending: T, failure: AutosaveFailure) => void;
}

export interface Autosave<T> {
  status: AutosaveState;
  failure: AutosaveFailure | null;
  /** True while a save is in flight or waiting on the debounce. */
  busy: boolean;
  run(value: T): void;
  retry(): void;
  /** Save a value waiting on the debounce now (no-op when nothing is waiting). */
  flush(): void;
}

export const INVALID_CODE = "invalid_input";
/** 12-17: a CDS service window locks the target (TargetLocked). */
export const LOCKED_CODE = "target_locked";

export function useAutosave<T>(
  save: (value: T) => Promise<HubActionResult<unknown>>,
  opts: AutosaveOptions<T> = {},
): Autosave<T> {
  const [status, setStatus] = useState<AutosaveState>("idle");
  const [failure, setFailure] = useState<AutosaveFailure | null>(null);
  const [busy, setBusy] = useState(false);

  const latest = useRef({ save, opts });
  useEffect(() => {
    latest.current = { save, opts };
  });

  const inFlight = useRef(false);
  const queued = useRef<{ value: T } | null>(null);
  const failed = useRef<{ value: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  const enqueue = useCallback((value: T) => {
    const merge = latest.current.opts.merge;
    queued.current =
      queued.current && merge
        ? { value: merge(queued.current.value, value) }
        : { value };
  }, []);

  const start = useCallback(async () => {
    if (inFlight.current) return;
    if (!queued.current) {
      // Nothing left to send (e.g. a debounce firing after its value already went out):
      // nothing is pending, so busy must not stay true (12-REVIEW WR-D01).
      if (!timer.current && mounted.current) setBusy(false);
      return;
    }
    // Taking the queued value now: the debounce armed for it has nothing left to do.
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const { value } = queued.current;
    queued.current = null;
    inFlight.current = true;
    setBusy(true);
    setStatus("saving");
    let res: HubActionResult<unknown>;
    try {
      res = await latest.current.save(value);
    } catch {
      res = { ok: false, code: "save_failed", message: "" };
    }
    inFlight.current = false;
    if (!mounted.current) {
      // Unmounted mid-save: no state to update, but a queued value still goes out.
      if (queued.current) void start();
      return;
    }
    if (res.ok) {
      failed.current = null;
      setFailure(null);
      latest.current.opts.onSaved?.(res.data, value);
    } else if (res.code === LOCKED_CODE) {
      const f: AutosaveFailure = { code: res.code, message: res.message };
      // Locked: never retried. The refused value and everything queued behind it are one
      // pending change for the held draft.
      const merge = latest.current.opts.merge;
      // (A cast: TS keeps the null from the top of start() across the await.)
      const q = queued.current as { value: T } | null;
      queued.current = null;
      // The queue was folded in, so a debounce armed for it has nothing to send.
      if (q && timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      const pending: T = q ? (merge ? merge(value, q.value) : q.value) : value;
      setFailure(f);
      setBusy(Boolean(timer.current));
      const onLocked = latest.current.opts.onLocked;
      if (onLocked) {
        failed.current = null;
        onLocked(pending, f);
        setStatus("paused");
      } else {
        // No editor parks it (WR-D01): keep the pending change as a failed save, so Try
        // again re-sends it once the window ends instead of it being lost.
        failed.current = { value: pending };
        latest.current.opts.onFailed?.(f, pending);
        setStatus("error");
      }
      return;
    } else {
      const f: AutosaveFailure = {
        code: res.code,
        message: res.message,
        ...(res.field ? { field: res.field } : {}),
      };
      // An invalid value is not retried as-is; the owner fixes the field instead.
      failed.current = res.code === INVALID_CODE ? null : { value };
      setFailure(f);
      latest.current.opts.onFailed?.(f, value);
    }
    if (queued.current) {
      void start();
      return;
    }
    setBusy(Boolean(timer.current));
    setStatus(
      res.ok ? "saved" : res.code === INVALID_CODE ? "invalid" : "error",
    );
  }, []);

  const run = useCallback(
    (value: T) => {
      enqueue(value);
      const wait = latest.current.opts.debounceMs ?? 0;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (wait > 0) {
        setBusy(true);
        timer.current = setTimeout(() => {
          timer.current = null;
          void start();
        }, wait);
        return;
      }
      void start();
    },
    [enqueue, start],
  );

  const retry = useCallback(() => {
    const f = failed.current;
    if (!f) return;
    failed.current = null;
    // The failed value is older than anything queued since: fold it underneath.
    const merge = latest.current.opts.merge;
    const q = queued.current;
    if (!q) queued.current = { value: f.value };
    else if (merge) queued.current = { value: merge(f.value, q.value) };
    void start();
  }, [start]);

  const flush = useCallback(() => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    void start();
  }, [start]);

  useEffect(() => {
    mounted.current = true;
    const onHide = () => flush();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      mounted.current = false;
      // Leaving the stage within the debounce window still saves the pending value.
      flush();
    };
  }, [flush]);

  return { status, failure, busy, run, retry, flush };
}

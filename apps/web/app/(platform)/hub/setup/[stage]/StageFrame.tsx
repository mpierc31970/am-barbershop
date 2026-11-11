"use client";
// The shared step frame (06-18; 06-UI-SPEC "Stages" frame + autosave contract; ONB-02,
// D-UI-P6-19). At 1024px and up: StageRail (240px) + the form column (max 720px), 32px gap;
// below, the rail is one "Step N of 7" line. Header: Display step name + one AutosaveStatus
// for the whole step. Footer (sticky, 64px, top border): Back to all steps · the one primary,
// Next: {step} (ArrowRight) or, on the last step, Review what's still needed. The primary
// only navigates; every field has already saved itself.
//
// Step forms save through useStageAutosave(key, save): each field (or field group) gets its
// own queue, and the frame folds them into one status (error > saving > invalid > saved).
// Leaving with a field that failed validation asks first (P3 leave guard: "Leave without
// saving this field?" Leave · Keep editing, autofocused); leaving in the app while a save is
// pending sends it and waits for it first (C-CR-01); closing the tab while a save is in
// flight triggers the browser's beforeunload prompt.
import type { StageSlug } from "@cds/core/intake";
import {
  AutosaveStatus,
  Button,
  Dialog,
  InlineAlert,
  StageRail,
  buttonClasses,
  useAutosave,
  type AutosaveOptions,
  type AutosaveState,
  type HubActionResult,
} from "@cds/ui/hub";
import { ArrowRight } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { dismissFirstVisitAction } from "../../../../actions/intake";
import { GuardedLink } from "../../GuardedLink";
import { useRegisterNavGuard } from "../../nav-guard";
import { FrameTitle } from "../../FrameTitle";

export const READ_ONLY_COPY = "Only the owner or an admin can change settings.";
export const LEAVE_TITLE = "Leave without saving this field?";

type Entry = {
  status: AutosaveState;
  busy: boolean;
  retry: () => void;
  /** Send a value still waiting on the debounce now. */
  flush: () => void;
};

/**
 * Leaving while a save is pending waits this long for it (C-CR-01). After that the
 * navigation runs anyway: useAutosave still sends a pending or queued value after unmount.
 */
export const LEAVE_WAIT_MS = 10_000;

type StageSaveApi = {
  report(key: string, entry: Entry | null): void;
  setInvalid(key: string, invalid: boolean): void;
};

const NOOP: StageSaveApi = { report: () => {}, setInvalid: () => {} };
const StageSaveContext = createContext<StageSaveApi>(NOOP);

/** Fold the per-field states into the one header status. */
export function foldStatus(
  entries: readonly Entry[],
  invalidCount: number,
): AutosaveState {
  if (entries.some((e) => e.status === "error")) return "error";
  if (entries.some((e) => e.status === "saving")) return "saving";
  if (invalidCount > 0) return "invalid";
  if (entries.some((e) => e.status === "saved")) return "saved";
  return "idle";
}

/**
 * Autosave for one field or field group inside a step. Reports its status to the frame and
 * marks the field invalid while the server refuses its value.
 */
export function useStageAutosave<T>(
  key: string,
  save: (value: T) => Promise<HubActionResult<unknown>>,
  opts: AutosaveOptions<T> = {},
) {
  const api = useContext(StageSaveContext);
  const auto = useAutosave(save, opts);
  const { status, busy, retry, flush } = auto;
  useEffect(() => {
    api.report(key, { status, busy, retry, flush });
  }, [api, key, status, busy, retry, flush]);
  // A field that leaves (a Settings tab switch keeps the scope) takes its state with it,
  // or a stale refusal would keep the header and the leave guard stuck (C-WR-01).
  useEffect(
    () => () => {
      api.report(key, null);
      api.setInvalid(key, false);
    },
    [api, key],
  );
  useEffect(() => {
    api.setInvalid(key, status === "invalid");
  }, [api, key, status]);
  return auto;
}

/** A field-level client check (e.g. the GA4 pattern) that blocks leaving until fixed. */
export function useStageInvalid(key: string, invalid: boolean): void {
  const api = useContext(StageSaveContext);
  useEffect(() => {
    api.setInvalid(key, invalid);
    return () => api.setInvalid(key, false);
  }, [api, key, invalid]);
}

export type StageFrameStage = {
  slug: StageSlug;
  name: string;
  href: string;
  status: "not_started" | "started" | "done";
};

export interface StageFrameProps {
  stages: readonly StageFrameStage[];
  current: StageSlug;
  readOnly: boolean;
  /** True until the owner first opens a step (the overview's welcome alert). */
  dismissFirstVisit: boolean;
  children: ReactNode;
}

/**
 * One autosave scope: the fields inside report to it, and it folds them into one status,
 * asks before closing the tab mid-save and before leaving with a refused field. The setup
 * StageFrame and Settings (06-22) each own one.
 */
export function useSaveScope() {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [invalid, setInvalidKeys] = useState<Record<string, true>>({});
  const [pendingNav, setPendingNav] = useState<{ run: () => void } | null>(
    null,
  );

  const api = useMemo<StageSaveApi>(
    () => ({
      report(key, entry) {
        setEntries((prev) => {
          if (!entry) {
            if (!Object.hasOwn(prev, key)) return prev;
            const next = { ...prev };
            delete next[key];
            return next;
          }
          const old = prev[key];
          if (
            old &&
            old.status === entry.status &&
            old.busy === entry.busy &&
            old.retry === entry.retry &&
            old.flush === entry.flush
          ) {
            return prev;
          }
          return { ...prev, [key]: entry };
        });
      },
      setInvalid(key, on) {
        setInvalidKeys((prev) => {
          if (on === Object.hasOwn(prev, key)) return prev;
          const next = { ...prev };
          if (on) next[key] = true;
          else delete next[key];
          return next;
        });
      },
    }),
    [],
  );

  const list = Object.values(entries);
  const invalidCount = Object.keys(invalid).length;
  const state = foldStatus(list, invalidCount);
  const busy = list.some((e) => e.busy);
  const retryAll = useCallback(() => {
    for (const e of Object.values(entries)) {
      if (e.status === "error") e.retry();
    }
  }, [entries]);

  // Closing the tab mid-save asks first (P3 pattern).
  useEffect(() => {
    if (!busy) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [busy]);

  // Leaving with a refused field, or with a field whose save failed (its value never
  // reached the server, R2-WR-03), asks first (hub nav, rail, footer: all guarded links).
  // Leaving while a save is pending or in flight (C-CR-01) sends it at once and waits for
  // it: if any field is then refused or failed, the owner is asked as above (Keep editing
  // leaves them here, where the header offers Try again); otherwise the navigation runs
  // once every field has saved.
  const [leaving, setLeaving] = useState<{ run: () => void } | null>(null);
  const now = useRef({ invalidCount, busy, entries });
  useEffect(() => {
    now.current = { invalidCount, busy, entries };
  });
  useRegisterNavGuard((go) => {
    const cur = now.current;
    const failed = Object.values(cur.entries).some((e) => e.status === "error");
    if (cur.invalidCount > 0 || (failed && !cur.busy)) {
      setPendingNav({ run: go });
      return true;
    }
    if (!cur.busy) return false;
    for (const e of Object.values(cur.entries)) e.flush();
    setLeaving({ run: go });
    return true;
  });
  useEffect(() => {
    if (!leaving) return;
    if (busy) {
      const t = setTimeout(() => {
        setLeaving(null);
        leaving.run();
      }, LEAVE_WAIT_MS);
      return () => clearTimeout(t);
    }
    setLeaving(null);
    // Any failed field, not only a newly failed one: a field that fails again after a new
    // edit must not be dropped either (R2-WR-03).
    const failed = Object.values(entries).some((e) => e.status === "error");
    if (failed || invalidCount > 0) {
      setPendingNav({ run: leaving.run });
      return;
    }
    leaving.run();
  }, [leaving, busy, entries, invalidCount]);

  return {
    api,
    state,
    invalidCount,
    retryAll,
    pendingNav,
    closeLeave: () => setPendingNav(null),
  };
}

export type SaveScope = ReturnType<typeof useSaveScope>;

/** Provides a scope to the fields below it. */
export function SaveScopeProvider({
  scope,
  children,
}: {
  scope: SaveScope;
  children: ReactNode;
}) {
  return (
    <StageSaveContext.Provider value={scope.api}>
      {children}
    </StageSaveContext.Provider>
  );
}

/** P3 leave guard: "Leave without saving this field?" Leave · Keep editing (autofocused). */
export function LeaveGuardDialog({ scope }: { scope: SaveScope }) {
  const { pendingNav, closeLeave } = scope;
  return (
    <Dialog
      open={pendingNav !== null}
      onClose={closeLeave}
      title={LEAVE_TITLE}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              const go = pendingNav?.run;
              closeLeave();
              go?.();
            }}
          >
            Leave
          </Button>
          <Button variant="primary" autoFocus onClick={closeLeave}>
            Keep editing
          </Button>
        </>
      }
    >
      A field here has a value we couldn&apos;t save. If you leave now, that
      change is lost.
    </Dialog>
  );
}

export function StageFrame({
  stages,
  current,
  readOnly,
  dismissFirstVisit,
  children,
}: StageFrameProps) {
  const scope = useSaveScope();
  const { state, invalidCount, retryAll } = scope;

  // A still-needed link (/hub/setup/contact#field-phone) lands focus on that field.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!/^field-[a-z0-9_-]+$/i.test(id)) return;
    const el = document.getElementById(id);
    if (!el) return;
    const target = el.matches("input, select, textarea")
      ? el
      : (el.querySelector<HTMLElement>(
          "input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
        ) ?? el);
    target.focus();
  }, []);

  // Opening a step retires the overview's first-visit welcome (06-UI-SPEC).
  const dismissed = useRef(false);
  useEffect(() => {
    if (!dismissFirstVisit || readOnly || dismissed.current) return;
    dismissed.current = true;
    void dismissFirstVisitAction();
  }, [dismissFirstVisit, readOnly]);

  const index = stages.findIndex((s) => s.slug === current);
  const stage = stages[index];
  const next = index >= 0 ? stages[index + 1] : undefined;

  return (
    <SaveScopeProvider scope={scope}>
      <div className="flex flex-col gap-6 font-hub lg:flex-row lg:gap-8">
        <StageRail
          stages={stages}
          current={current}
          allHref="/hub/setup"
          LinkComponent={GuardedLink}
        />
        <div className="flex w-full max-w-[720px] min-w-0 flex-col gap-8">
          <header className="flex flex-wrap items-baseline justify-between gap-4">
            <FrameTitle
              className="text-[1.75rem] leading-tight font-semibold text-balance text-hub-ink"
              helpId="setup"
              name="setup"
            >
              {stage?.name ?? ""}
            </FrameTitle>
            <AutosaveStatus
              state={state}
              invalidCount={invalidCount}
              onRetry={retryAll}
            />
          </header>
          {readOnly ? (
            <InlineAlert tone="info">{READ_ONLY_COPY}</InlineAlert>
          ) : null}
          <div className="flex flex-col gap-12">{children}</div>
          <footer className="sticky bottom-0 flex min-h-16 flex-col-reverse gap-2 border-t border-hub-border bg-hub-surface py-3 sm:flex-row sm:items-center sm:justify-between">
            <GuardedLink
              href="/hub/setup"
              className={`${buttonClasses("secondary", "md")} w-full sm:w-auto`}
            >
              Back to all steps
            </GuardedLink>
            {next ? (
              <GuardedLink
                href={next.href}
                className={`${buttonClasses("primary", "md")} w-full sm:w-auto`}
              >
                Next: {next.name}
                <ArrowRight aria-hidden size={16} strokeWidth={2} />
              </GuardedLink>
            ) : (
              <GuardedLink
                href="/hub/setup"
                className={`${buttonClasses("primary", "md")} w-full sm:w-auto`}
              >
                Review what&apos;s still needed
              </GuardedLink>
            )}
          </footer>
        </div>
      </div>
      <LeaveGuardDialog scope={scope} />
    </SaveScopeProvider>
  );
}

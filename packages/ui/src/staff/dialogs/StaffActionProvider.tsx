"use client";
// Staff action provider (13-09; STAFF-06; RESEARCH Pattern 3, Pitfall 12; 13-UI-SPEC
// "StepUpDialog"). Mounted once by the console layout (the web app, 13-25) with the two step-up
// server actions from 13-21. It renders the single StepUpDialog and exposes `stepUp(then)`
// to useStaffAction: request a code, show the dialog, resolve true once confirmStepUp
// succeeds (the server has refreshed the 15-minute window), false when the person stops.
// The browser decides nothing: the retried action re-checks freshness server-side
// (T-13-09-02). session_ended anywhere sends the browser to /staff/sign-in?next=<here>.
import { P13_COPY } from "@cds/core/staff";
import {
  createContext,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { STEP_UP_ERROR_CODES } from "./copy";
import { StepUpDialog } from "./StepUpDialog";

/** Structural copy of the web app's ActionResult (the ui package never imports the web app). */
export type StaffActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; field?: string };

export interface StepUpCode {
  otpId: string;
  maskedEmail: string;
}

export interface StaffActionProviderProps {
  requestStepUpCode: () => Promise<StaffActionResult<StepUpCode>>;
  confirmStepUp: (input: {
    otpId: string;
    code: string;
  }) => Promise<StaffActionResult<null>>;
  /** Full-page navigation; defaults to location.assign. */
  navigate?: (href: string) => void;
  children: ReactNode;
}

export interface StaffActionContextValue {
  stepUp: (thenLabel?: string) => Promise<boolean>;
  signInAgain: () => void;
}

export const StaffActionContext = createContext<StaffActionContextValue | null>(
  null,
);

/** `/staff/sign-in?next=<current path + query>` (same-origin path only). */
export function staffSignInHref(): string {
  const here =
    typeof window === "undefined"
      ? "/staff"
      : `${window.location.pathname}${window.location.search}`;
  return `/staff/sign-in?next=${encodeURIComponent(here)}`;
}

/** Fixed copy for a failed step-up request or confirm. */
export function stepUpErrorCopy(r: { code: string; message: string }): string {
  const id = STEP_UP_ERROR_CODES[r.code as keyof typeof STEP_UP_ERROR_CODES];
  if (id) return P13_COPY[id];
  return r.message || P13_COPY.CODE_WRONG;
}

interface StepUpState {
  open: boolean;
  thenLabel?: string;
  otpId: string | null;
  maskedEmail: string | null;
  pending: boolean;
  error: string | null;
  attempt: number;
}

const CLOSED: StepUpState = {
  open: false,
  otpId: null,
  maskedEmail: null,
  pending: false,
  error: null,
  attempt: 0,
};

export function StaffActionProvider({
  requestStepUpCode,
  confirmStepUp,
  navigate,
  children,
}: StaffActionProviderProps) {
  const [state, setState] = useState<StepUpState>(CLOSED);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const otpRef = useRef<string | null>(null);

  const go = useCallback(
    (href: string) => {
      if (navigate) navigate(href);
      else window.location.assign(href);
    },
    [navigate],
  );

  const signInAgain = useCallback(() => go(staffSignInHref()), [go]);

  const finish = useCallback((ok: boolean) => {
    const resolve = resolver.current;
    resolver.current = null;
    otpRef.current = null;
    setState(CLOSED);
    resolve?.(ok);
  }, []);

  const requestCode = useCallback(async (): Promise<boolean> => {
    let r: StaffActionResult<StepUpCode>;
    try {
      r = await requestStepUpCode();
    } catch (err) {
      console.warn(
        "staff-step-up:request-failed",
        err instanceof Error ? err.name : typeof err,
      );
      r = { ok: false, code: "error", message: P13_COPY.ERR_SEND };
    }
    if (r.ok) {
      otpRef.current = r.data.otpId;
      setState((s) => ({
        ...s,
        otpId: r.data.otpId,
        maskedEmail: r.data.maskedEmail,
        error: null,
      }));
      return true;
    }
    if (r.code === "session_ended") {
      finish(false);
      signInAgain();
      return false;
    }
    const message = stepUpErrorCopy(r);
    setState((s) => ({ ...s, error: message, attempt: s.attempt + 1 }));
    return false;
  }, [requestStepUpCode, finish, signInAgain]);

  const stepUp = useCallback(
    (thenLabel?: string) =>
      new Promise<boolean>((resolve) => {
        // One step-up at a time: an older pending one is stopped.
        resolver.current?.(false);
        resolver.current = resolve;
        otpRef.current = null;
        setState({ ...CLOSED, open: true, thenLabel });
        void requestCode();
      }),
    [requestCode],
  );

  const onSubmit = useCallback(
    async (code: string) => {
      const otpId = otpRef.current;
      if (!otpId) return;
      setState((s) => ({ ...s, pending: true, error: null }));
      let r: StaffActionResult<null>;
      try {
        r = await confirmStepUp({ otpId, code });
      } catch (err) {
        console.warn(
          "staff-step-up:confirm-failed",
          err instanceof Error ? err.name : typeof err,
        );
        r = { ok: false, code: "error", message: P13_COPY.ERR_SEND };
      }
      if (r.ok) {
        finish(true);
        return;
      }
      if (r.code === "session_ended") {
        finish(false);
        signInAgain();
        return;
      }
      const message = stepUpErrorCopy(r);
      setState((s) => ({
        ...s,
        pending: false,
        error: message,
        attempt: s.attempt + 1,
      }));
    },
    [confirmStepUp, finish, signInAgain],
  );

  const value = useMemo<StaffActionContextValue>(
    () => ({ stepUp, signInAgain }),
    [stepUp, signInAgain],
  );

  return (
    <StaffActionContext.Provider value={value}>
      {children}
      <StepUpDialog
        open={state.open}
        maskedEmail={state.maskedEmail}
        thenLabel={state.thenLabel}
        pending={state.pending}
        error={state.error}
        errorKey={state.attempt}
        onSubmit={(code) => void onSubmit(code)}
        onResend={requestCode}
        onStop={() => finish(false)}
      />
    </StaffActionContext.Provider>
  );
}

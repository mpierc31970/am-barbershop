"use client";
// Hub navigation guard (WR-B05). The builder keeps the hub sidebar on screen, and App
// Router soft navigations and Server Action redirects never fire `beforeunload`. So the
// sidebar links and Sign out ask this guard before they leave: a screen with unsaved work
// (the Builder) registers an interceptor that opens its own "Save changes to … block?"
// dialog and runs the navigation afterwards. With nothing registered, every navigation
// proceeds as normal.
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

/**
 * Called with the navigation to run. Returns true when it took over (the screen is dirty
 * and will run `go` itself after the owner answers), false to let the navigation proceed.
 */
export type NavInterceptor = (go: () => void) => boolean;

export interface NavGuard {
  /** True when a registered screen took over; the caller must cancel its own navigation. */
  intercept(go: () => void): boolean;
  register(interceptor: NavInterceptor): () => void;
}

/**
 * True for a plain primary click, the only click that navigates this tab. Ctrl/Cmd/Shift/
 * Alt or a middle click opens a new tab or window, so the guard must stay out (IN-R05).
 */
export function isPlainLeftClick(e: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

/**
 * A link click through the guard: modifier/middle clicks and already-handled clicks pass;
 * a plain click the guard takes over is cancelled, and `go` runs after the owner answers.
 */
export function guardLinkClick(
  e: Parameters<typeof isPlainLeftClick>[0] & {
    defaultPrevented: boolean;
    preventDefault(): void;
  },
  guard: Pick<NavGuard, "intercept">,
  go: () => void,
): void {
  if (e.defaultPrevented || !isPlainLeftClick(e)) return;
  if (guard.intercept(go)) e.preventDefault();
}

/** The pure core: one interceptor slot, last registration wins. */
export function createNavGuard(): NavGuard {
  let current: NavInterceptor | null = null;
  return {
    intercept(go) {
      return current ? current(go) : false;
    },
    register(interceptor) {
      current = interceptor;
      return () => {
        if (current === interceptor) current = null;
      };
    },
  };
}

const NOOP_GUARD: NavGuard = {
  intercept: () => false,
  register: () => () => {},
};

const NavGuardContext = createContext<NavGuard>(NOOP_GUARD);

export function NavGuardProvider({ children }: { children: ReactNode }) {
  const guard = useMemo(() => createNavGuard(), []);
  return (
    <NavGuardContext.Provider value={guard}>
      {children}
    </NavGuardContext.Provider>
  );
}

export function useNavGuard(): NavGuard {
  return useContext(NavGuardContext);
}

/** Register `interceptor` for as long as the calling component is mounted. */
export function useRegisterNavGuard(interceptor: NavInterceptor): void {
  const { register } = useNavGuard();
  const latest = useRef(interceptor);
  useEffect(() => {
    latest.current = interceptor;
  });
  useEffect(() => register((go) => latest.current(go)), [register]);
}

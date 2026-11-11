// @cds/db P7 area barrel: Protected pages + 404 (owner 07-32).
// Named exports only; never export a PocketBase client, a context minter or an internal
// writer helper (invariant 1). Wired into src/index.ts with `export *` (07-02).
// The scrypt hash helpers stay internal to password.ts and gate.ts.
export {
  setPagePassword,
  PAGE_PASSWORD_MIN,
  PAGE_PASSWORD_MAX,
  PAGE_PASSWORD_COPY,
} from "./password";
export type { SetPagePasswordDeps } from "./password";
export {
  gateCookieName,
  mintGateCookie,
  gateCookieValid,
  GATE_COOKIE_TTL_S,
} from "./cookie";
export {
  readPageGate,
  verifyPagePassword,
  WrongPagePassword,
  GateRateLimited,
  GATE_COPY,
} from "./gate";
export type { PageGate } from "./gate";
export {
  getNotFoundPage,
  ensureNotFoundPage,
  NOT_FOUND_TITLE,
  NOT_FOUND_TEXT,
} from "./not-found";

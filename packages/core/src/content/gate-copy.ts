// Password gate copy (CONT-28, D235 #12; 07-UI-SPEC lines 638-640 verbatim; 07-32 choice 14).
// Pure and Edge-safe: the site gate (@cds/ui/site) and the db gate (@cds/db) both read it,
// so the visitor copy has one source.
export const GATE_COPY = Object.freeze({
  wrong: "That password isn't right. Check it and try again.",
  rate: "Too many tries. Wait 15 minutes, then try again.",
  /** A network or server failure, never a wrong password (WR-D06). */
  error: "Something went wrong. Try again.",
  body: "This page is private. Enter the password to see it.",
  label: "Password",
  submit: "View page",
  show: "Show",
  hide: "Hide",
  tryAgainIn: (minutes: number): string =>
    `Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`,
});

/** The longest wait the gate shows, in minutes (the limiter window). */
export const GATE_WAIT_MAX_MIN = 15;

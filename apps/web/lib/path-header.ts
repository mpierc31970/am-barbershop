// The request path header (09-15, RESEARCH Pattern 7; T-09-15-02). Layouts and Server
// Actions cannot see the pathname, so the middleware strips any client-sent copy on every
// request and sets pathname + search on platform requests. The re-acceptance gate reads it
// (lib/agreement-gate.ts). Pure and Edge-safe: the middleware imports it.
export const PATH_HEADER = "x-cds-path";

/** Longer values are omitted (never truncated mid-escape); the gate then uses /hub. */
export const MAX_PATH_HEADER = 2048;

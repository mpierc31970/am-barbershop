// P8 (08-17): the in-process assembly queue (CONTEXT A2-Q1; RESEARCH Pattern 5; T-08-17-02,
// T-08-17-03). Concurrency 1: one site is assembled at a time in the 1 GB / 1 CPU container.
// Send to CDS enqueues fire-and-forget; the hourly sweep (jobs/assembly.ts) runs on the same
// queue so the two never assemble in parallel. Errors are logged by code or error name only.
import { createQueue, type Queue } from "../media/queue";
import { runAssemblyForOrg, type AssemblyRunDeps } from "./run";

const ORG_ID = /^[a-z0-9]{15}$/;

/** The process-wide assembly queue. */
export const assemblyQueue: Queue = createQueue();

/** A log-safe label for a thrown value: its `code` when it has one, else its name. */
export function assemblyErrorLabel(err: unknown): string {
  if (err && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Za-z_]{2,40}$/.test(code)) return code;
    const name = (err as { name?: unknown }).name;
    if (typeof name === "string" && /^[A-Za-z_]{1,60}$/.test(name)) return name;
  }
  return "Error";
}

/**
 * Queue one org for assembly and return at once. The caller passes the org id from the
 * session (never from input); a malformed id is logged and dropped. Never rejects.
 */
export function enqueueAssembly(orgId: string, deps: AssemblyRunDeps): void {
  if (typeof orgId !== "string" || !ORG_ID.test(orgId)) {
    console.error("[assembly] INVALID_ORG_ID");
    return;
  }
  assemblyQueue
    .run(() => runAssemblyForOrg(orgId, deps))
    .catch((err: unknown) => {
      console.error(`[assembly] ${assemblyErrorLabel(err)}`);
    });
}

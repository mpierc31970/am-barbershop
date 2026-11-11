// Next.js instrumentation (07-13 choice 10; CONTEXT resolution e; T-07-13-10). On the Node
// runtime only, 30 s after the server starts, pick up every video that was waiting or being
// optimized when the process stopped (resumeVideoJobs). The hourly stuck sweep is 07-27's job
// route. Skipped during `next build` and when CDS_VIDEO_RESUME=off. Errors are caught and
// logged, never thrown (a failed resume must not stop the server).
// @cds/db is imported only inside the `NEXT_RUNTIME === "nodejs"` block: Next replaces that
// variable at compile time, so the Edge bundle drops the block and never pulls in the db
// package (sharp, child_process). Keep the import inside it.
const VIDEO_RESUME_DELAY_MS = 30_000;

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NEXT_PHASE === "phase-production-build") return;
    // AGR-01 (09-08; RESEARCH Open Question 4): mirror the compiled policy texts into
    // policy_versions once at boot, never awaited, so startup is not delayed. A failure
    // (e.g. a hash-guard conflict) is logged by message only; the signing screen retries
    // the sync lazily and shows a load error until it succeeds.
    if (process.env.PB_URL) {
      void import("@cds/db")
        .then((db) => db.syncPolicyVersions())
        .catch((err: unknown) => {
          console.error(
            "[legal] policy sync failed",
            err instanceof Error ? err.message : "unknown error",
          );
        });
    }
    if (process.env.CDS_VIDEO_RESUME === "off") return;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const { resumeVideoJobs } = await import("@cds/db");
          const r = await resumeVideoJobs();
          console.info(
            `[video] resume: ${r.requeued} requeued, ${r.failed} failed`,
          );
        } catch {
          console.error("[video] resume failed");
        }
      })();
    }, VIDEO_RESUME_DELAY_MS);
    timer.unref?.();
  }
}

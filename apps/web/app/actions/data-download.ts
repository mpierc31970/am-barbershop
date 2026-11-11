"use server";
// Settings › Business info › Your data actions (11-41 choice 3; LIFE-04; D285; T-11-41-03).
// Public POST endpoints with no arguments: the org and person come only from the session
// (runAction). The Owner check runs here first (impersonating staff and other roles are
// answered with their own view, never a build) and again in @cds/db (requestDataDownload).
// Refusals the panel can explain are answered with the fresh view: the 24-hour limit shows
// DATA-LIMIT, a build already running shows Building, impersonation IMPERSONATING-DATA, a
// non-owner the "Only the site owner…" line. Anything else is a short retry message.
// The add-on registry is imported for its side effect: the build lists add-on collections
// (11-40: it must be registered before runDataDownloads runs in this process).
import "@cds/addon-registry/server";
import { InvalidInput } from "@cds/core";
import { requestDataDownload } from "@cds/db";
import type { DataDownloadView } from "@cds/ui/hub/people";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "../../lib/action";
import { loadDataDownloadView } from "../../lib/data-download-view";

const REQUEST_FAILED =
  "We couldn't start your download just now. Try again in a minute.";

function refreshSettings(): void {
  try {
    revalidatePath("/hub/settings");
  } catch (err) {
    console.error(
      "[hub] data download: revalidate failed",
      err instanceof Error ? err.name : typeof err,
    );
  }
}

export async function requestDataDownloadAction(): Promise<
  ActionResult<DataDownloadView>
> {
  const res = await runAction(
    async ({ ctx }) => {
      if (ctx.impersonator || ctx.role !== "owner") {
        return loadDataDownloadView(ctx);
      }
      try {
        await requestDataDownload(ctx);
      } catch (err) {
        // Limit or a build already running: the fresh view explains it.
        if (!(err instanceof InvalidInput)) throw err;
      }
      refreshSettings();
      return loadDataDownloadView(ctx);
    },
    { forbidden: REQUEST_FAILED },
  );
  // Review 11 WR-E04: only a generic failure becomes "try again"; the re-accept gate
  // (agreement_required) and other typed refusals keep their own copy.
  if (res.ok || res.code !== "save_failed") return res;
  return { ok: false, code: res.code, message: REQUEST_FAILED };
}

/** The Building poll (every 15 s): the same view, read-only. */
export async function readDataDownloadAction(): Promise<
  ActionResult<DataDownloadView>
> {
  return runAction(({ ctx }) => loadDataDownloadView(ctx));
}

// Client-side Server Action call (WR-B02). A Server Action fetch can reject (network drop,
// a server crash before runAction returns) instead of resolving to an ActionResult. Every
// builder handler calls actions through callAction, so a rejection becomes the same failed
// result as a server-side failure: the handler's `!res.ok` branch reverts its optimistic
// state and shows the ERR-SAVE copy, and nothing turns into an unhandled rejection.
// Client-safe: no server imports.
import { ERR_SAVE_COPY, type BuilderResult } from "@cds/ui/builder";

export async function callAction<T>(
  call: () => Promise<BuilderResult<T>>,
): Promise<BuilderResult<T>> {
  try {
    return await call();
  } catch (err) {
    console.error("[hub action] request failed", err);
    return { ok: false, code: "save_failed", message: ERR_SAVE_COPY };
  }
}

"use client";
// Settings › Business info › Your data client island (11-41; LIFE-04; D285). Adapts the two
// Server Actions (ActionResult) to DataDownloadPanel's plain callbacks; the first view is
// server-built in the settings page (null when the state read failed: ERR-SECTION).
import { DataDownloadPanel, type DataDownloadView } from "@cds/ui/hub/people";
import {
  readDataDownloadAction,
  requestDataDownloadAction,
} from "../../../actions/data-download";

const REQUEST_FAILED =
  "We couldn't start your download just now. Try again in a minute.";

export function YourDataSection({
  initial,
}: {
  initial: DataDownloadView | null;
}) {
  return (
    <DataDownloadPanel
      initial={initial}
      onRequest={async () => {
        try {
          const res = await requestDataDownloadAction();
          return res.ok
            ? { ok: true, view: res.data }
            : { ok: false, message: res.message };
        } catch {
          return { ok: false, message: REQUEST_FAILED };
        }
      }}
      onRefresh={async () => {
        try {
          const res = await readDataDownloadAction();
          return res.ok ? res.data : null;
        } catch {
          return null;
        }
      }}
    />
  );
}

"use client";
// Site-part History drawer (07-29; CONT-36, D184, D187; 07-UI-SPEC "History", states row,
// "History empty", ERR-RESTORE, "Restore a history version"; choices 12-13; D311).
// Right Drawer 480px on the Navigation, Footer, Banner and Site settings tabs. Rows are
// newest first: the date (Body 600, tabular) over "Saved by …" (Label, ink-muted). The live
// version sits on hub-surface-2 with the Current badge and no Restore; every other row has
// a secondary sm Restore. Restore asks first in a Dialog whose safe choice (Keep current)
// holds focus; the current version stays in history, so a restore is itself undoable.
// Data and actions arrive as props; the drawer never reads storage.
// 11-25 (DASH-07, D184, D254; 11-UI-SPEC "Page history"): part "page" lists a page's last 10
// published versions ("Published by …", "Set up by CDS from your answers" for P8 assembly);
// its restore publishes ("Restore and publish"), and `readOnly` (Viewers) hides Restore.
import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HubActionResult } from "./addon-types";
import { formatBackupDate } from "./BackupsPanel";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { Drawer } from "./Drawer";
import { InlineAlert, Skeleton } from "./feedback";
import { IconButton } from "./IconButton";
import { useToast } from "./Toast";

export type HistoryPartKey = "nav" | "footer" | "banner" | "settings" | "page";

export type HistoryVersionAuthor =
  | { kind: "member"; name: string }
  | { kind: "former" }
  | { kind: "support" }
  | { kind: "assembly" }
  | { kind: "earlier" };

/** Structurally equal to @cds/db SiteVersion and PageVersion. */
export type HistoryVersionView = {
  id: string;
  /** ISO timestamp. */
  at: string;
  who: HistoryVersionAuthor;
  current: boolean;
};

type PartCopy = {
  title: string;
  noun: string;
  ariaNoun: string;
  plural: boolean;
};

const PARTS: Readonly<Record<HistoryPartKey, PartCopy>> = Object.freeze({
  nav: {
    title: "Navigation history",
    noun: "menu",
    ariaNoun: "navigation",
    plural: false,
  },
  footer: {
    title: "Footer history",
    noun: "footer",
    ariaNoun: "footer",
    plural: false,
  },
  banner: {
    title: "Banner history",
    noun: "banner",
    ariaNoun: "banner",
    plural: false,
  },
  settings: {
    title: "Site settings history",
    noun: "settings",
    ariaNoun: "site settings",
    plural: true,
  },
  page: {
    title: "Page history",
    noun: "page",
    ariaNoun: "this page",
    plural: false,
  },
});

/** The page part's own copy (11-UI-SPEC "Page history"). */
const PAGE_COPY = Object.freeze({
  intro: "We keep the last 10 published versions of this page.",
  empty:
    "No earlier versions yet. Each time you publish, the previous version is kept here.",
  confirm: "Restore and publish",
  readOnly: "Only editors can restore a version.",
  held: "Restored. It's being reviewed before it shows, usually within 2 business days.",
  dialogBody:
    "This page goes back to how it was then and is published straight away. The current version stays in this history, so you can switch back.",
});

/** "9 Oct" from "9 Oct, 2:14 pm". */
function dayOf(date: string): string {
  return date.split(",")[0] ?? date;
}

export const HISTORY_COPY = Object.freeze({
  parts: PARTS,
  button: "History",
  intro: "We keep the last 10 versions.",
  empty:
    "No earlier versions yet. Each time you save, the previous version is kept here.",
  restoreFailed:
    "The restore didn't finish, so nothing changed. Try again in a minute.",
  loadFailed: "We couldn't load this. Check your connection and try again.",
  tryAgain: "Try again",
  unsaved: "Your unsaved changes on this screen will be lost.",
  dropped: "A button to a pop-up or page you've since deleted was left out.",
  current: "Current",
  restore: "Restore",
  confirm: "Restore this version",
  keep: "Keep current",
  restoring: "Restoring…",
  listLabel: "Saved versions",
  page: PAGE_COPY,
  introFor(part: HistoryPartKey): string {
    return part === "page" ? PAGE_COPY.intro : HISTORY_COPY.intro;
  },
  emptyFor(part: HistoryPartKey): string {
    return part === "page" ? PAGE_COPY.empty : HISTORY_COPY.empty;
  },
  confirmFor(part: HistoryPartKey): string {
    return part === "page" ? PAGE_COPY.confirm : HISTORY_COPY.confirm;
  },
  who(who: HistoryVersionAuthor, part?: HistoryPartKey): string {
    if (part === "page") {
      switch (who.kind) {
        case "member":
          return `Published by ${who.name}`;
        case "former":
          return "Published by a former team member";
        case "support":
          return "Published by Support";
        case "assembly":
          return "Set up by Support from your answers";
        default:
          return "Published before history was turned on";
      }
    }
    switch (who.kind) {
      case "member":
        return `Saved by ${who.name}`;
      case "former":
        return "Saved by a former team member";
      case "support":
      case "assembly":
        return "Saved by Support";
      default:
        return "Saved before history was turned on";
    }
  },
  restoreLabel(part: HistoryPartKey, date: string): string {
    return `Restore ${PARTS[part].ariaNoun} from ${date}`;
  },
  dialogTitle(part: HistoryPartKey, date: string): string {
    if (part === "page") return `Restore this page from ${dayOf(date)}?`;
    return `Restore your ${PARTS[part].noun} from ${date}?`;
  },
  dialogBody(part: HistoryPartKey): string {
    if (part === "page") return PAGE_COPY.dialogBody;
    const p = PARTS[part];
    return p.plural
      ? `Your site's ${p.noun} go back to how they were then. Your current ${p.noun} are kept in this history, so you can switch back.`
      : `Your site's ${p.noun} goes back to how it was then. Your current ${p.noun} is kept in this history, so you can switch back.`;
  },
  success(part: HistoryPartKey, date: string): string {
    if (part === "page") {
      return `Restored. Your page shows the version from ${dayOf(date)}.`;
    }
    return part === "settings"
      ? `Restored. Your site uses the settings from ${date}.`
      : `Restored. Your site shows the ${PARTS[part].noun} from ${date}.`;
  },
});

export interface HistoryDrawerProps {
  open: boolean;
  onClose: () => void;
  part: HistoryPartKey;
  list: () => Promise<HubActionResult<HistoryVersionView[]>>;
  restore: (version: string) => Promise<HubActionResult<HistoryRestored>>;
  /** After a successful restore (the drawer has toasted). */
  onRestored: () => void;
  /** The form has unsaved edits: the dialog warns they will be lost. */
  unsavedChanges?: boolean;
  /** Viewers: the list without Restore (11-25). */
  readOnly?: boolean;
  timeZone?: string;
}

/** What a restore reports back; `held` = the publish scan is reviewing it (page part). */
export type HistoryRestored = { at: string; dropped: number; held?: boolean };

type Load =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; versions: HistoryVersionView[] };

export function HistoryDrawer({
  open,
  onClose,
  part,
  list,
  restore,
  onRestored,
  unsavedChanges = false,
  readOnly = false,
  timeZone,
}: HistoryDrawerProps) {
  const toast = useToast();
  const copy = PARTS[part];
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [confirm, setConfirm] = useState<HistoryVersionView | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [dropped, setDropped] = useState(false);
  const listRef = useRef(list);
  useEffect(() => {
    listRef.current = list;
  });

  const reload = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      const res = await listRef.current();
      setLoad(
        res.ok
          ? {
              state: "ready",
              versions: [...res.data]
                .sort((a, b) => b.at.localeCompare(a.at))
                .slice(0, 10),
            }
          : { state: "error" },
      );
    } catch {
      setLoad({ state: "error" });
    }
  }, []);

  useEffect(() => {
    if (open) {
      setDropped(false);
      void reload();
    }
  }, [open, reload]);

  async function doRestore() {
    if (!confirm) return;
    const target = confirm;
    setRestoring(true);
    setRestoreError(null);
    let res: HubActionResult<HistoryRestored>;
    try {
      res = await restore(target.id);
    } catch {
      res = {
        ok: false,
        code: "save_failed",
        message: HISTORY_COPY.restoreFailed,
      };
    }
    setRestoring(false);
    if (!res.ok) {
      setRestoreError(
        res.code === "signed_out" || res.code === "forbidden"
          ? res.message
          : HISTORY_COPY.restoreFailed,
      );
      return;
    }
    setConfirm(null);
    setDropped(res.data.dropped > 0);
    toast.show({
      message:
        part === "page" && res.data.held
          ? PAGE_COPY.held
          : HISTORY_COPY.success(part, formatBackupDate(target.at, timeZone)),
    });
    onRestored();
    await reload();
  }

  const versions = load.state === "ready" ? load.versions : [];
  const older = versions.filter((v) => !v.current);
  const confirmDate = confirm ? formatBackupDate(confirm.at, timeZone) : "";

  return (
    <>
      <Drawer open={open} onClose={onClose} label={copy.title} side="right">
        <div className="flex items-center justify-between gap-2 border-b border-hub-border px-6 py-4">
          <h2 className="text-xl leading-tight font-semibold">{copy.title}</h2>
          <IconButton
            label="Close"
            tooltipAlign="end"
            onClick={onClose}
            icon={<X aria-hidden size={20} strokeWidth={2} />}
          />
        </div>
        <div className="flex flex-1 flex-col gap-4 p-6">
          <p className="text-sm text-hub-ink-muted">
            {HISTORY_COPY.introFor(part)}
          </p>
          {readOnly ? (
            <p className="text-sm text-hub-ink-muted">{PAGE_COPY.readOnly}</p>
          ) : null}
          {dropped ? (
            <InlineAlert tone="info">{HISTORY_COPY.dropped}</InlineAlert>
          ) : null}
          {load.state === "loading" ? (
            <Skeleton rows={3} rowHeight={64} />
          ) : load.state === "error" ? (
            <InlineAlert
              tone="error"
              action={
                <Button size="sm" onClick={() => void reload()}>
                  {HISTORY_COPY.tryAgain}
                </Button>
              }
            >
              {HISTORY_COPY.loadFailed}
            </InlineAlert>
          ) : (
            <>
              {versions.length > 0 ? (
                <ol
                  aria-label={HISTORY_COPY.listLabel}
                  className="flex flex-col"
                >
                  {versions.map((v) => {
                    const date = formatBackupDate(v.at, timeZone);
                    return (
                      <li
                        key={v.id}
                        data-version={v.id}
                        data-current={v.current ? "" : undefined}
                        className={`flex min-h-16 items-center gap-4 border-b border-hub-border px-3 py-2 ${
                          v.current ? "bg-hub-surface-2" : ""
                        }`}
                      >
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="text-base font-semibold tabular-nums">
                            {date}
                          </span>
                          <span className="text-sm break-words text-hub-ink-muted">
                            {HISTORY_COPY.who(v.who, part)}
                          </span>
                        </div>
                        {v.current ? (
                          <Badge tone="current">{HISTORY_COPY.current}</Badge>
                        ) : readOnly ? null : (
                          <Button
                            size="sm"
                            aria-label={HISTORY_COPY.restoreLabel(part, date)}
                            onClick={() => {
                              setRestoreError(null);
                              setConfirm(v);
                            }}
                          >
                            {HISTORY_COPY.restore}
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ol>
              ) : null}
              {older.length === 0 ? (
                <p className="text-base text-hub-ink">
                  {HISTORY_COPY.emptyFor(part)}
                </p>
              ) : null}
            </>
          )}
        </div>
      </Drawer>
      {readOnly ? null : (
        <Dialog
          open={confirm !== null}
          onClose={() => {
            if (!restoring) setConfirm(null);
          }}
          title={HISTORY_COPY.dialogTitle(part, confirmDate)}
          footer={
            <>
              <Button
                variant="ghost"
                autoFocus
                disabled={restoring}
                onClick={() => setConfirm(null)}
              >
                {HISTORY_COPY.keep}
              </Button>
              <Button
                variant="primary"
                loading={restoring}
                loadingLabel={HISTORY_COPY.restoring}
                onClick={() => void doRestore()}
              >
                {HISTORY_COPY.confirmFor(part)}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            {restoreError ? (
              <InlineAlert tone="error">{restoreError}</InlineAlert>
            ) : null}
            <p>
              {HISTORY_COPY.dialogBody(part)}
              {unsavedChanges ? ` ${HISTORY_COPY.unsaved}` : ""}
            </p>
          </div>
        </Dialog>
      )}
    </>
  );
}

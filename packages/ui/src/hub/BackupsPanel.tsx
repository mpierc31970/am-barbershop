"use client";
// Backups drawer (05-06; ADDON-14, D126, D187, D-UI-P5-7; 05-UI-SPEC "Backups").
// Right Drawer 480px, title "Backups". Lists at most the last 3 backups (newest first),
// each with Restore; the footer offers "Save a backup now" (this drawer has no primary).
// Restore asks first in a Dialog whose safe choice ("Keep current list") holds focus; the
// server backs the current list up before restoring, so a restore is itself undoable.
// Data and actions arrive as props; the panel never reads storage itself.
import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BackupReason, BackupView, HubActionResult } from "./addon-types";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { Drawer } from "./Drawer";
import { InlineAlert, Skeleton } from "./feedback";
import { IconButton } from "./IconButton";
import { useToast } from "./Toast";

export const MAX_BACKUPS = 3;
export const BACKUPS_INTRO =
  "A backup is saved before every import. We keep your last 3; older ones are removed automatically.";
export const NO_BACKUPS_COPY =
  "No backups yet. One is saved automatically before your first import.";
export const RESTORE_FAILED_COPY =
  "The restore didn't finish, so nothing changed. Try again.";
const LOAD_FAILED_COPY =
  "We couldn't load this. Check your connection and try again.";

const REASON_LABEL: Record<BackupReason, string> = {
  "before-import": "Before import",
  manual: "Saved by you",
  "before-restore": "Before restore",
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "27 Sep, 2:14 pm" in the given IANA zone (the browser's when unset). */
export function formatBackupDate(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
    ...(timeZone ? { timeZone } : {}),
  }).formatToParts(d);
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value ?? "0");
  const hour24 = get("hour") % 24;
  const minute = String(get("minute")).padStart(2, "0");
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const suffix = hour24 < 12 ? "am" : "pm";
  return `${get("day")} ${MONTHS[get("month") - 1] ?? ""}, ${hour12}:${minute} ${suffix}`;
}

/** "27 Sep" (the helper under Save names only the day). */
function dayOf(iso: string, timeZone?: string): string {
  return formatBackupDate(iso, timeZone).split(",")[0] ?? iso;
}

export interface BackupsPanelProps {
  open: boolean;
  onClose: () => void;
  /** Lower-case plural, "testimonials". */
  plural: string;
  /** Lower-case singular for a count of 1; defaults to plural. */
  singular?: string;
  list: () => Promise<HubActionResult<BackupView[]>>;
  save: () => Promise<HubActionResult<BackupView>>;
  restore: (id: string) => Promise<HubActionResult<null>>;
  /** After a successful restore (the panel has toasted): refresh the list. */
  onRestored: (backup: BackupView) => void;
  timeZone?: string;
}

type Load =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; backups: BackupView[] };

export function BackupsPanel({
  open,
  onClose,
  plural,
  singular,
  list,
  save,
  restore,
  onRestored,
  timeZone,
}: BackupsPanelProps) {
  const toast = useToast();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<BackupView | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const listRef = useRef(list);
  useEffect(() => {
    listRef.current = list;
  });

  const count = (n: number) =>
    `${n} ${n === 1 ? (singular ?? plural) : plural}`;

  const reload = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      const res = await listRef.current();
      setLoad(
        res.ok
          ? {
              state: "ready",
              backups: [...res.data]
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .slice(0, MAX_BACKUPS),
            }
          : { state: "error" },
      );
    } catch {
      setLoad({ state: "error" });
    }
  }, []);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  async function saveNow() {
    setSaving(true);
    setSaveError(null);
    let res: HubActionResult<BackupView>;
    try {
      res = await save();
    } catch {
      res = { ok: false, code: "save_failed", message: LOAD_FAILED_COPY };
    }
    setSaving(false);
    if (!res.ok) {
      setSaveError(res.message);
      return;
    }
    toast.show({ message: "Backup saved." });
    await reload();
  }

  async function doRestore() {
    if (!confirm) return;
    const target = confirm;
    setRestoring(true);
    setRestoreError(null);
    let res: HubActionResult<null>;
    try {
      res = await restore(target.id);
    } catch {
      res = { ok: false, code: "save_failed", message: RESTORE_FAILED_COPY };
    }
    setRestoring(false);
    if (!res.ok) {
      setRestoreError(
        res.code === "signed_out" || res.code === "forbidden"
          ? res.message
          : RESTORE_FAILED_COPY,
      );
      return;
    }
    setConfirm(null);
    toast.show({
      message: `Restored. Your list matches the backup from ${formatBackupDate(target.createdAt, timeZone)}.`,
    });
    onRestored(target);
    await reload();
  }

  const backups = load.state === "ready" ? load.backups : [];
  const oldest =
    backups.length >= MAX_BACKUPS ? backups[backups.length - 1] : null;
  const confirmDate = confirm
    ? formatBackupDate(confirm.createdAt, timeZone)
    : "";

  return (
    <>
      <Drawer open={open} onClose={onClose} label="Backups" side="right">
        <div className="flex items-center justify-between gap-2 border-b border-hub-border px-6 py-4">
          <h2 className="text-xl leading-tight font-semibold">Backups</h2>
          <IconButton
            label="Close"
            tooltipAlign="end"
            onClick={onClose}
            icon={<X aria-hidden size={20} strokeWidth={2} />}
          />
        </div>
        <div className="flex flex-1 flex-col gap-4 p-6">
          <p className="text-sm text-hub-ink-muted">{BACKUPS_INTRO}</p>
          {load.state === "loading" ? (
            <Skeleton rows={3} rowHeight={64} />
          ) : load.state === "error" ? (
            <InlineAlert
              tone="error"
              action={
                <Button size="sm" onClick={() => void reload()}>
                  Try again
                </Button>
              }
            >
              {LOAD_FAILED_COPY}
            </InlineAlert>
          ) : backups.length === 0 ? (
            <p className="text-base text-hub-ink">{NO_BACKUPS_COPY}</p>
          ) : (
            <ul aria-label="Your backups" className="flex flex-col">
              {backups.map((b) => {
                const date = formatBackupDate(b.createdAt, timeZone);
                return (
                  <li
                    key={b.id}
                    data-backup={b.id}
                    className="flex min-h-16 items-center gap-4 border-b border-hub-border py-2"
                  >
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="text-base font-semibold">
                        {REASON_LABEL[b.reason]}
                      </span>
                      <span className="text-sm text-hub-ink-muted tabular-nums">
                        {`${date} · ${count(b.count)}`}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      aria-label={`Restore backup from ${date}`}
                      onClick={() => {
                        setRestoreError(null);
                        setConfirm(b);
                      }}
                    >
                      Restore
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          {saveError ? (
            <InlineAlert tone="error">{saveError}</InlineAlert>
          ) : null}
        </div>
        <div className="flex flex-col items-start gap-2 border-t border-hub-border px-6 py-4">
          <Button
            onClick={() => void saveNow()}
            loading={saving}
            loadingLabel="Saving…"
            disabled={load.state === "loading"}
          >
            Save a backup now
          </Button>
          {oldest ? (
            <p className="text-sm text-hub-ink-muted">
              {`Saving a new one removes the backup from ${dayOf(oldest.createdAt, timeZone)}.`}
            </p>
          ) : null}
        </div>
      </Drawer>
      <Dialog
        open={confirm !== null}
        onClose={() => {
          if (!restoring) setConfirm(null);
        }}
        title={`Restore the backup from ${confirmDate}?`}
        footer={
          <>
            <Button
              variant="ghost"
              autoFocus
              disabled={restoring}
              onClick={() => setConfirm(null)}
            >
              Keep current list
            </Button>
            <Button
              variant="primary"
              loading={restoring}
              loadingLabel="Restoring…"
              onClick={() => void doRestore()}
            >
              Restore backup
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {restoreError ? (
            <InlineAlert tone="error">{restoreError}</InlineAlert>
          ) : null}
          <p>
            {confirm
              ? `Your ${plural} go back to how they were then (${count(confirm.count)}). Your current list is backed up first.`
              : null}
          </p>
        </div>
      </Dialog>
    </>
  );
}

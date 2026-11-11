"use client";
// Pop-ups list pane (CONT-12, D118, D275; 03-UI-SPEC "Pop-ups tab", "Destructive actions";
// impeccable standard). Each row: name (link to its editor), the trigger summary, the Show
// pop-up switch, and an inline overflow disclosure (Preview pop-up · Delete pop-up), the
// same model as the builder's block rows. Footer: Create pop-up.
//
// The switch is optimistic: it flips at once and snaps back with a toast if the save
// fails; a held switch-on stays off with the review line. Delete always confirms; a used
// pop-up is soft-deleted and keeps opening from its buttons (CONT-36, D275). The dialog body
// comes from the server's usage (pages named) and Keep pop-up is focused.
import {
  Button,
  Dialog,
  IconButton,
  Switch,
  buttonClasses,
  useToast,
} from "@cds/ui/hub";
import { Eye, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { GuardedLink as Link } from "../GuardedLink";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  deletePopupAction,
  popupUsageAction,
  setPopupEnabledAction,
} from "../../../actions/popups";
import {
  POPUP_HELD_COPY,
  deleteDialogTitle,
  deletePopupBody,
  popupsHref,
} from "./popup-logic";

export type PopupRow = {
  id: string;
  name: string;
  summary: string;
  enabled: boolean;
};

const ERR_SAVE =
  "Your changes weren't saved. Try again; if it keeps failing, copy your text somewhere safe first.";

const MENU_ITEM =
  "flex min-h-10 w-full items-center gap-2 rounded px-3 text-left text-sm text-hub-ink " +
  "transition-colors duration-150 hover:bg-hub-surface-2 disabled:cursor-not-allowed " +
  "disabled:opacity-50 pointer-coarse:min-h-11";

export interface PopupListProps {
  popups: readonly PopupRow[];
  /** The open pop-up's id, "new" while creating, or null. */
  selectedId: string | null;
}

export function PopupList({ popups, selectedId }: PopupListProps) {
  const router = useRouter();
  const toast = useToast();
  // Optimistic switch values; cleared whenever the server list changes.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  useEffect(() => setOverrides({}), [popups]);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    row: PopupRow;
    body: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  async function toggle(row: PopupRow, next: boolean) {
    setOverrides((o) => ({ ...o, [row.id]: next }));
    const res = await setPopupEnabledAction(row.id, next).catch(() => null);
    if (!res || !res.ok) {
      setOverrides((o) => ({ ...o, [row.id]: !next }));
      toast.show({ message: res?.message ?? ERR_SAVE });
      return;
    }
    if (res.data.held) {
      setOverrides((o) => ({ ...o, [row.id]: false }));
      toast.show({ message: POPUP_HELD_COPY });
    }
    router.refresh();
  }

  async function askDelete(row: PopupRow) {
    setBusy(true);
    const res = await popupUsageAction(row.id).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      toast.show({ message: res?.message ?? ERR_SAVE });
      return;
    }
    setConfirm({ row, body: deletePopupBody(res.data) });
  }

  async function doDelete() {
    const row = confirm?.row;
    if (!row) return;
    setBusy(true);
    const res = await deletePopupAction(row.id).catch(() => null);
    setBusy(false);
    setConfirm(null);
    if (!res || !res.ok) {
      toast.show({ message: res?.message ?? ERR_SAVE });
      return;
    }
    setMenuFor(null);
    toast.show({ message: `${row.name} pop-up deleted.` });
    if (selectedId === row.id) router.replace(popupsHref(), { scroll: false });
    router.refresh();
  }

  return (
    <section
      aria-labelledby="popups-heading"
      className="flex flex-col gap-4 font-hub text-hub-ink"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="popups-heading" className="text-xl leading-tight font-semibold">
          Pop-ups
        </h2>
        <span className="text-sm text-hub-ink-muted tabular-nums">
          {popups.length} {popups.length === 1 ? "pop-up" : "pop-ups"}
        </span>
      </div>

      {popups.length === 0 ? (
        <p className="text-sm text-hub-ink-muted">No pop-ups yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {popups.map((row) => {
            const selected = row.id === selectedId;
            const enabled = overrides[row.id] ?? row.enabled;
            const menuId = `popup-menu-${row.id}`;
            const nameId = `popup-name-${row.id}`;
            const menuOpen = menuFor === row.id;
            return (
              <li
                key={row.id}
                className={
                  "flex flex-col gap-3 rounded border p-4 transition-colors duration-150 " +
                  (selected
                    ? "border-hub-accent bg-hub-accent-tint"
                    : "border-hub-border bg-hub-surface hover:bg-hub-surface-2")
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <Link
                    href={popupsHref(row.id)}
                    aria-current={selected ? "true" : undefined}
                    className="flex min-w-0 flex-col gap-1 rounded"
                  >
                    <span
                      id={nameId}
                      className={`truncate text-base font-semibold ${selected ? "text-hub-accent" : "text-hub-ink"}`}
                    >
                      {row.name}
                    </span>
                    <span className="text-sm text-hub-ink-muted">
                      {row.summary}
                    </span>
                  </Link>
                  <IconButton
                    size="sm"
                    label={`More actions for ${row.name}`}
                    tooltipAlign="end"
                    aria-expanded={menuOpen}
                    aria-controls={menuId}
                    icon={
                      <MoreHorizontal aria-hidden size={16} strokeWidth={2} />
                    }
                    onClick={() => setMenuFor(menuOpen ? null : row.id)}
                  />
                </div>
                <Switch
                  id={`popup-enabled-${row.id}`}
                  label="Show pop-up"
                  aria-describedby={nameId}
                  checked={enabled}
                  onChange={(v) => void toggle(row, v)}
                />
                {menuOpen ? (
                  <ul
                    id={menuId}
                    aria-label={`Actions for ${row.name}`}
                    className="flex flex-col gap-1 rounded border border-hub-border bg-hub-surface p-1"
                  >
                    <li>
                      <button
                        type="button"
                        className={MENU_ITEM}
                        aria-haspopup="dialog"
                        data-cds-popup-open={row.id}
                      >
                        <Eye aria-hidden size={16} strokeWidth={2} />
                        Preview pop-up
                      </button>
                    </li>
                    <li>
                      <button
                        type="button"
                        className={`${MENU_ITEM} text-hub-danger hover:bg-hub-danger-tint`}
                        disabled={busy}
                        onClick={() => void askDelete(row)}
                      >
                        <Trash2 aria-hidden size={16} strokeWidth={2} />
                        Delete pop-up
                      </button>
                    </li>
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <div>
        <Link
          href={popupsHref("new")}
          aria-current={selectedId === "new" ? "true" : undefined}
          className={buttonClasses("secondary")}
        >
          <Plus aria-hidden size={16} strokeWidth={2} />
          Create pop-up
        </Link>
      </div>

      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={deleteDialogTitle(confirm?.row.name ?? "")}
        footer={
          <>
            <Button autoFocus onClick={() => setConfirm(null)}>
              Keep pop-up
            </Button>
            <Button
              variant="destructive"
              loading={busy}
              loadingLabel="Deleting…"
              onClick={() => void doDelete()}
            >
              Delete pop-up
            </Button>
          </>
        }
      >
        <p>{confirm?.body ?? ""}</p>
      </Dialog>
    </section>
  );
}

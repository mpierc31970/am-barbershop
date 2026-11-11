"use client";
// Services list (06-20; 06-UI-SPEC "Team, Services › Services", "Destructive actions"; ONB-01,
// D37, D120, D-UI-P6-20). Reused by setup step "Your words & services" and Website › Services:
// the host passes the list, readOnly and the context.
//   - Header (P5 AddonTabHeader): count line, Add a service (hidden while empty, R2), Import,
//     and a More menu with Export CSV and the template. No Backups panel in P6.
//   - Rows (RecordList): name over "From $45 · 60 min" / "Free" / "Ask for a price", Hidden
//     badge, Show on site switch (optimistic, snaps back), overflow Edit / Move up / Move
//     down / Delete service.
//   - Delete asks first; Keep service is focused.
//   - The drawer is URL-held (?record=service-<id>|service-new).
// Nothing here reaches @cds/db: every change goes through the core-lists actions.
import {
  AddonTabHeader,
  Badge,
  Button,
  CsvImportDialog,
  Dialog,
  EmptyState,
  IconButton,
  RecordList,
  Switch,
  useToast,
  type ImportCommitResult,
  type RecordMoveHandle,
} from "@cds/ui/hub";
import { MoreHorizontal, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ServiceView } from "../../../../lib/intake";
import {
  commitCoreImportAction,
  deleteServiceAction,
  exportCoreCsvAction,
  previewCoreImportAction,
  reorderServicesAction,
  setServicePublishedAction,
  templateCoreCsvAction,
} from "../../../actions/core-lists";
import {
  download,
  priceLine,
  useRecordParam,
  type ListContext,
} from "./list-helpers";
import { ServiceDrawer } from "./ServiceDrawer";

export const SERVICES_COPY = {
  heading: "Services",
  add: "Add a service",
  emptyAdd: "Add your first service",
  importTitle: "Import services",
  exportCsv: "Export CSV",
  template: "Download the template",
  listLabel: "Your services",
  noun: "service",
  singular: "service",
  plural: "services",
  emptyHeading: "No services yet",
  emptyBody:
    "List what you offer and what it costs. Visitors see them on your site, and you choose which to show.",
  emptyImport: "Import from a spreadsheet",
  emptyHelper:
    "Have a price list in Excel or on paper? Type it into our template and import it all at once.",
  hidden: "Hidden",
  showOnSite: "Show on site",
  showLabel: (name: string) => `Show ${name} on site`,
  moreLabel: (name: string) => `More actions for ${name}`,
  menuLabel: (name: string) => `Actions for ${name}`,
  edit: "Edit",
  moveUp: "Move up",
  moveDown: "Move down",
  remove: "Delete service",
  removeTitle: (name: string) => `Delete ${name}?`,
  removeBody:
    "It disappears from your site right away. To keep it but stop showing it, turn off Show on site instead.",
  keep: "Keep service",
  saved: "Service saved.",
  /** 13-52 (D270): the records held line (testimonials / credentials TOAST.held). */
  held: "Saved. It shows on your site once it's reviewed, usually within 2 business days.",
  removed: "Service deleted.",
  toggleFailed: "That change didn't save. Try again.",
  reorderFailed: "That move didn't save, so the list went back. Try again.",
  exported: (n: number) => `Exported ${n} ${n === 1 ? "service" : "services"}.`,
  imported: (added: number, updated: number) =>
    `Imported. ${added} added, ${updated} updated.`,
} as const;

/** "4 services · 3 shown on your site" */
export function servicesCountLine(total: number, shown: number): string {
  return `${total} ${total === 1 ? "service" : "services"} · ${shown} shown on your site`;
}

const MENU_ITEM =
  "flex min-h-10 w-full items-center gap-2 rounded px-3 text-left text-sm text-hub-ink " +
  "transition-colors duration-150 hover:bg-hub-surface-2 disabled:cursor-not-allowed " +
  "disabled:opacity-50 pointer-coarse:min-h-11";

export interface ServicesSectionProps {
  data: ServiceView[];
  readOnly: boolean;
  context: ListContext;
  /** After any saved change (setup marks the step saved). */
  onChanged?: () => void;
}

export function ServicesSection({
  data,
  readOnly,
  context,
  onChanged,
}: ServicesSectionProps) {
  const router = useRouter();
  const toast = useToast();
  const drawer = useRecordParam("service");
  const [list, setList] = useState(data);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ServiceView | null>(null);
  const [removing, setRemoving] = useState(false);
  const [importing, setImporting] = useState(false);
  useEffect(() => setList(data), [data]);

  const shown = list.filter((s) => s.is_published).length;
  const empty = list.length === 0;
  const editing =
    drawer.value && drawer.value !== "new"
      ? (list.find((s) => s.id === drawer.value) ?? null)
      : null;
  const drawerOpen = !readOnly && (drawer.value === "new" || editing !== null);
  const headingId = `services-heading-${context}`;

  function changed() {
    onChanged?.();
    router.refresh();
  }

  function failed(res: { ok: false; message: string } | null) {
    toast.show({ message: res ? res.message : SERVICES_COPY.toggleFailed });
  }

  async function toggle(s: ServiceView, next: boolean) {
    setList((l) =>
      l.map((x) => (x.id === s.id ? { ...x, is_published: next } : x)),
    );
    const res = await setServicePublishedAction(s.id, next).catch(() => null);
    if (!res || !res.ok) {
      setList((l) =>
        l.map((x) => (x.id === s.id ? { ...x, is_published: !next } : x)),
      );
      toast.show({ message: SERVICES_COPY.toggleFailed });
      return;
    }
    if (res.data.held) {
      setList((l) =>
        l.map((x) => (x.id === s.id ? { ...x, is_published: false } : x)),
      );
      toast.show({ message: SERVICES_COPY.held });
    }
    changed();
  }

  async function reorder(ids: string[]): Promise<boolean> {
    const res = await reorderServicesAction(ids).catch(() => null);
    if (!res || !res.ok) {
      toast.show({ message: SERVICES_COPY.reorderFailed });
      return false;
    }
    setList((l) =>
      ids
        .map((id) => l.find((s) => s.id === id))
        .filter((s): s is ServiceView => s !== undefined),
    );
    changed();
    return true;
  }

  async function doDelete() {
    const s = confirm;
    if (!s) return;
    setRemoving(true);
    const res = await deleteServiceAction(s.id).catch(() => null);
    setRemoving(false);
    setConfirm(null);
    if (!res || !res.ok) {
      failed(res && !res.ok ? res : null);
      return;
    }
    setList((l) => l.filter((x) => x.id !== s.id));
    toast.show({ message: SERVICES_COPY.removed });
    if (drawer.value === s.id) drawer.close();
    changed();
  }

  async function exportCsv() {
    const res = await exportCoreCsvAction("services").catch(() => null);
    if (!res || !res.ok) {
      failed(res && !res.ok ? res : null);
      return;
    }
    download(res.data);
    toast.show({ message: SERVICES_COPY.exported(list.length) });
  }

  async function template() {
    const res = await templateCoreCsvAction("services").catch(() => null);
    if (!res || !res.ok) {
      failed(res && !res.ok ? res : null);
      return;
    }
    download(res.data);
  }

  function imported(result: ImportCommitResult) {
    toast.show({
      message: SERVICES_COPY.imported(result.added, result.updated),
    });
    changed();
  }

  const openImport = readOnly ? undefined : () => setImporting(true);

  function renderRow(s: ServiceView, handle: RecordMoveHandle) {
    const menuOpen = menuFor === s.id;
    const menuId = `service-menu-${s.id}`;
    return (
      <div className="flex min-h-16 min-w-0 flex-1 flex-col gap-2 py-3 md:flex-row md:items-center md:gap-4">
        <button
          type="button"
          disabled={readOnly}
          onClick={() => drawer.open(s.id)}
          className={`flex min-w-0 flex-1 flex-col rounded text-left disabled:cursor-default ${s.is_published ? "" : "opacity-60"}`}
        >
          <span className="truncate text-base font-semibold text-hub-ink">
            {s.name}
          </span>
          <span className="truncate text-sm text-hub-ink-muted tabular-nums">
            {priceLine(s)}
          </span>
        </button>
        <div className="relative flex flex-wrap items-center gap-2">
          {!s.is_published ? (
            <Badge tone="hidden">{SERVICES_COPY.hidden}</Badge>
          ) : null}
          <Switch
            id={`service-shown-${s.id}`}
            label={SERVICES_COPY.showOnSite}
            aria-label={SERVICES_COPY.showLabel(s.name)}
            checked={s.is_published}
            disabled={readOnly}
            onChange={(v) => void toggle(s, v)}
          />
          {readOnly ? null : (
            <IconButton
              size="sm"
              label={SERVICES_COPY.moreLabel(s.name)}
              tooltipAlign="end"
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? menuId : undefined}
              onClick={() => setMenuFor(menuOpen ? null : s.id)}
              icon={<MoreHorizontal aria-hidden size={16} strokeWidth={2} />}
            />
          )}
          {menuOpen ? (
            <ul
              id={menuId}
              aria-label={SERVICES_COPY.menuLabel(s.name)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setMenuFor(null);
              }}
              className="absolute top-full right-0 z-20 mt-1 flex min-w-48 flex-col gap-1 rounded border border-hub-border bg-hub-surface p-1"
            >
              <li>
                <button
                  type="button"
                  className={MENU_ITEM}
                  onClick={() => {
                    setMenuFor(null);
                    drawer.open(s.id);
                  }}
                >
                  {SERVICES_COPY.edit}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={MENU_ITEM}
                  disabled={!handle.canMoveUp}
                  onClick={() => {
                    setMenuFor(null);
                    handle.moveUp();
                  }}
                >
                  {SERVICES_COPY.moveUp}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={MENU_ITEM}
                  disabled={!handle.canMoveDown}
                  onClick={() => {
                    setMenuFor(null);
                    handle.moveDown();
                  }}
                >
                  {SERVICES_COPY.moveDown}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={`${MENU_ITEM} text-hub-danger hover:bg-hub-danger-tint`}
                  onClick={() => {
                    setMenuFor(null);
                    setConfirm(s);
                  }}
                >
                  {SERVICES_COPY.remove}
                </button>
              </li>
            </ul>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 font-hub text-hub-ink"
    >
      <AddonTabHeader
        heading={SERVICES_COPY.heading}
        headingId={headingId}
        countLine={servicesCountLine(list.length, shown)}
        plural={SERVICES_COPY.plural}
        primary={
          empty || readOnly
            ? null
            : { label: SERVICES_COPY.add, onClick: () => drawer.open("new") }
        }
        onImport={openImport}
        menu={[
          ...(empty
            ? []
            : [
                {
                  label: SERVICES_COPY.exportCsv,
                  onSelect: () => void exportCsv(),
                },
              ]),
          { label: SERVICES_COPY.template, onSelect: () => void template() },
        ]}
      />
      {empty ? (
        <EmptyState
          heading={SERVICES_COPY.emptyHeading}
          body={SERVICES_COPY.emptyBody}
          action={
            readOnly ? null : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="primary" onClick={() => drawer.open("new")}>
                    {SERVICES_COPY.emptyAdd}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setImporting(true)}
                    icon={<Upload aria-hidden size={16} strokeWidth={2} />}
                  >
                    {SERVICES_COPY.emptyImport}
                  </Button>
                </div>
                <p className="text-sm text-hub-ink-muted">
                  {SERVICES_COPY.emptyHelper}
                </p>
              </div>
            )
          }
        />
      ) : (
        <RecordList<ServiceView>
          items={list}
          label={(s) => s.name}
          noun={SERVICES_COPY.noun}
          listLabel={SERVICES_COPY.listLabel}
          onReorder={reorder}
          renderRow={renderRow}
          readOnly={readOnly}
        />
      )}

      {drawerOpen ? (
        <ServiceDrawer
          key={editing ? editing.id : "new"}
          service={editing}
          onSaved={(saved, held) => {
            setList((l) =>
              l.some((x) => x.id === saved.id)
                ? l.map((x) => (x.id === saved.id ? saved : x))
                : [...l, saved],
            );
            drawer.close();
            toast.show({
              message: held ? SERVICES_COPY.held : SERVICES_COPY.saved,
            });
            changed();
          }}
          onClose={drawer.close}
        />
      ) : null}

      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm ? SERVICES_COPY.removeTitle(confirm.name) : ""}
        footer={
          <>
            <Button
              variant="destructive"
              loading={removing}
              onClick={() => void doDelete()}
            >
              {SERVICES_COPY.remove}
            </Button>
            <Button variant="ghost" autoFocus onClick={() => setConfirm(null)}>
              {SERVICES_COPY.keep}
            </Button>
          </>
        }
      >
        <p>{SERVICES_COPY.removeBody}</p>
      </Dialog>

      {readOnly ? null : (
        <CsvImportDialog
          open={importing}
          onClose={() => setImporting(false)}
          title={SERVICES_COPY.importTitle}
          singular={SERVICES_COPY.singular}
          plural={SERVICES_COPY.plural}
          onPreview={(text, mode) =>
            previewCoreImportAction("services", text, mode)
          }
          onCommit={(text, mode, removals) =>
            commitCoreImportAction("services", text, mode, removals)
          }
          onTemplate={() => void template()}
          onDone={imported}
        />
      )}
    </section>
  );
}

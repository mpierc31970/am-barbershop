"use client";
// Credentials tab (05-UI-SPEC "Add-on tabs", "Credentials tab", "Delete a record"; CONTEXT
// A5-Q2; D-UI-P5-9, D-UI-P5-16, D-UI-P5-17, R1, R2; D311). Data and Server Actions arrive as
// props (AddonPanelProps): this client module never reaches @cds/db (invariants 1 and 4).
//
// Same header, page line and notice pattern as Testimonials, with a grouped list: one header
// row per group ("Licenses · 3"), drag and Move up / down constrained to the group, rows
// with Expires soon / Expired badges, and an expiring notice (names are buttons that open
// the drawer). URL-held edit drawer (?record=<id>|new), delete confirm, CSV import with
// Undo import, Backups and the training drawer.
import {
  AddonTabHeader,
  Badge,
  BackupsPanel,
  Button,
  CsvImportDialog,
  Dialog,
  EmptyState,
  IconButton,
  InlineAlert,
  RecordList,
  Switch,
  TrainingDrawer,
  useToast,
  type AddonPanelProps,
  type AddonRecordView,
  type CsvFile,
  type ImportCommitResult,
  type RecordMoveHandle,
} from "@cds/ui/hub";
import { MoreHorizontal, Upload } from "lucide-react";
import { NAV_COPY } from "@cds/core/content";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import {
  expiresSoon,
  formatDayMonth,
  formatDayMonthYear,
  formatYear,
  isExpired,
} from "../expiry";
import {
  DELETE,
  EMPTY,
  ERR_SAVE,
  EXPIRING,
  NOTHING_SHOWN,
  PAGE_LINE,
  ROW,
  TAB,
  TOAST,
  countLine,
  heldNotice,
  navAdded,
} from "./copy";
import { CredentialDrawer } from "./CredentialDrawer";

const MENU_ITEM =
  "flex min-h-10 w-full items-center gap-2 rounded px-3 text-left text-sm text-hub-ink " +
  "transition-colors duration-150 hover:bg-hub-surface-2 disabled:cursor-not-allowed " +
  "disabled:opacity-50 pointer-coarse:min-h-11";

/** The page line's menu state from the server data (07-25). */
function navStateOf(
  page: AddonPanelProps["data"]["page"],
): "in" | "out" | "full" {
  if (!page || "deleted" in page) return "out";
  if (page.inNav) return "in";
  return page.navFull ? "full" : "out";
}

const s = (v: unknown) => (typeof v === "string" ? v : "");

export function titleOf(r: AddonRecordView): string {
  return s(r.values.title).trim() || "this credential";
}

/** The group a row sits under; RecordList files "" under "Other". */
export function groupOf(r: AddonRecordView): string {
  return s(r.values.category).trim();
}

/** "Texas Board of Nursing · No. RN123456 · Valid through 14 Mar 2027" (or "Issued 2019"). */
export function metaLine(r: AddonRecordView): string {
  const v = r.values;
  const number = s(v.credential_number).trim();
  const expires = formatDayMonthYear(v.expires_on);
  const issued = formatYear(v.issued_on);
  return [
    s(v.issuer).trim(),
    number ? ROW.number(number) : "",
    expires ? ROW.validThrough(expires) : issued ? ROW.issued(issued) : "",
  ]
    .filter((p) => p !== "")
    .join(" · ");
}

function download(file: CsvFile): void {
  const blob = new Blob([file.csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export type CredentialsPanelProps = AddonPanelProps & {
  /** The clock for expiry badges; tests pin it. Defaults to the time of first render. */
  now?: Date;
};

export function CredentialsPanel({
  data,
  actions,
  now: nowProp,
}: CredentialsPanelProps) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const toast = useToast();
  // 07-25: the page line's Add to navigation (CONTEXT Area 5 row 1). The page is resolved
  // server-side from this add-on's install record, never from a client id.
  const [navState, setNavState] = useState<"in" | "out" | "full">(() =>
    navStateOf(data.page),
  );
  const [navBusy, setNavBusy] = useState(false);
  const [navError, setNavError] = useState<string | null>(null);
  async function addToNav() {
    if (navBusy) return;
    setNavBusy(true);
    setNavError(null);
    const res = await actions.addToNav().catch(() => null);
    setNavBusy(false);
    if (!res) {
      setNavError(ERR_SAVE);
      return;
    }
    if (!res.ok) {
      setNavError(res.message);
      return;
    }
    if (res.data.added) {
      setNavState("in");
      toast.show({ message: navAdded(data.name) });
    } else {
      setNavState(res.data.reason === "full" ? "full" : "in");
    }
  }
  const [now] = useState(() => nowProp ?? new Date());

  const [published, setPublished] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setPublished({});
  }, [data.records]);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<AddonRecordView | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [training, setTraining] = useState(false);
  const [importing, setImporting] = useState(false);
  const [backups, setBackups] = useState(false);

  const records = data.records;
  const isPublished = (r: AddonRecordView) =>
    published[r.id] ?? r.values.is_published !== false;
  const expired = (r: AddonRecordView) => isExpired(r.values.expires_on, now);
  const shown = records.filter(
    (r) => isPublished(r) && !r.held && !expired(r),
  ).length;
  const heldCount = records.filter((r) => r.held).length;
  const expiring = records.filter(
    (r) => isPublished(r) && expiresSoon(r.values.expires_on, now),
  );
  const groups =
    data.groups ??
    [...new Set(records.map(groupOf))].filter((g) => g !== "").sort();

  // URL-held drawer state (?record=<id>|new) so refresh and back keep it.
  const recordParam = search?.get("record") ?? null;
  const editing =
    recordParam === null || recordParam === "new"
      ? null
      : (records.find((r) => r.id === recordParam) ?? null);
  const drawerOpen = recordParam === "new" || editing !== null;

  function hrefWith(record: string | null): string {
    const params = new URLSearchParams(search?.toString() ?? "");
    if (record === null) params.delete("record");
    else params.set("record", record);
    const q = params.toString();
    return `${pathname ?? ""}${q ? `?${q}` : ""}`;
  }
  const openDrawer = (id: string) => {
    setMenuFor(null);
    router.replace(hrefWith(id), { scroll: false });
  };
  const closeDrawer = () => router.replace(hrefWith(null), { scroll: false });

  async function toggleShown(r: AddonRecordView, next: boolean) {
    setPublished((o) => ({ ...o, [r.id]: next }));
    const res = await actions.setPublished(r.id, next).catch(() => null);
    if (!res || !res.ok) {
      setPublished((o) => ({ ...o, [r.id]: !next }));
      toast.show({ message: TOAST.toggleFailed });
      return;
    }
    if (res.data.held) {
      setPublished((o) => ({ ...o, [r.id]: false }));
      toast.show({ message: TOAST.held });
    }
    router.refresh();
  }

  async function reorder(ids: string[]): Promise<boolean> {
    const res = await actions.reorder(ids).catch(() => null);
    if (!res || !res.ok) {
      toast.show({ message: TOAST.reorderFailed });
      return false;
    }
    router.refresh();
    return true;
  }

  async function doDelete() {
    const r = confirm;
    if (!r) return;
    setDeleting(true);
    const res = await actions.remove(r.id).catch(() => null);
    setDeleting(false);
    setConfirm(null);
    if (!res || !res.ok) {
      toast.show({ message: res && !res.ok ? res.message : ERR_SAVE });
      return;
    }
    toast.show({ message: DELETE.done });
    if (recordParam === r.id) closeDrawer();
    router.refresh();
  }

  async function exportCsv() {
    const res = await actions.exportCsv().catch(() => null);
    if (!res || !res.ok) {
      toast.show({ message: res && !res.ok ? res.message : ERR_SAVE });
      return;
    }
    download(res.data);
    toast.show({ message: TOAST.exported(records.length) });
  }

  async function template() {
    const res = await actions.templateCsv().catch(() => null);
    if (!res || !res.ok) {
      toast.show({ message: res && !res.ok ? res.message : ERR_SAVE });
      return;
    }
    download(res.data);
  }

  function imported(result: ImportCommitResult) {
    router.refresh();
    toast.show({
      message: TOAST.imported(result.added, result.updated),
      action: {
        label: TOAST.undoImport,
        onClick: () => {
          void actions
            .restoreBackup(result.backupId)
            .catch(() => null)
            .then((res) => {
              toast.show({
                message: res && res.ok ? TOAST.importUndone : TOAST.undoFailed,
              });
              router.refresh();
            });
        },
      },
    });
  }

  const openImport = data.csvEnabled ? () => setImporting(true) : undefined;

  function renderRow(r: AddonRecordView, handle: RecordMoveHandle) {
    const title = titleOf(r);
    const on = isPublished(r);
    const gone = expired(r);
    const soon = !gone && expiresSoon(r.values.expires_on, now);
    const menuOpen = menuFor === r.id;
    const menuId = `credential-menu-${r.id}`;
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-2 py-3 md:flex-row md:items-center md:gap-4">
        <button
          type="button"
          onClick={() => openDrawer(r.id)}
          className={`flex min-w-0 flex-1 flex-col rounded text-left ${on && !r.held && !gone ? "" : "opacity-60"}`}
        >
          <span className="truncate text-base font-semibold text-hub-ink">
            {title}
          </span>
          <span className="truncate text-sm text-hub-ink-muted">
            {metaLine(r)}
          </span>
        </button>
        <div className="relative flex flex-wrap items-center gap-2">
          {soon ? (
            <Badge tone="expiring">
              {ROW.expiresSoon(formatDayMonth(r.values.expires_on))}
            </Badge>
          ) : null}
          {gone ? <Badge tone="expired">{ROW.expired}</Badge> : null}
          {r.held ? <Badge tone="review">{ROW.inReview}</Badge> : null}
          {!on ? <Badge tone="hidden">{ROW.hidden}</Badge> : null}
          <Switch
            id={`credential-shown-${r.id}`}
            label={ROW.showOnSite}
            aria-label={ROW.showOnSiteLabel(title)}
            checked={on}
            onChange={(v) => void toggleShown(r, v)}
          />
          <IconButton
            size="sm"
            label={ROW.moreLabel(title)}
            tooltipAlign="end"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={() => setMenuFor(menuOpen ? null : r.id)}
            icon={<MoreHorizontal aria-hidden size={16} strokeWidth={2} />}
          />
          {menuOpen ? (
            <ul
              id={menuId}
              aria-label={ROW.menuLabel(title)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setMenuFor(null);
              }}
              className="absolute top-full right-0 z-20 mt-1 flex min-w-48 flex-col gap-1 rounded border border-hub-border bg-hub-surface p-1"
            >
              <li>
                <button
                  type="button"
                  className={MENU_ITEM}
                  onClick={() => openDrawer(r.id)}
                >
                  {ROW.edit}
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
                  {ROW.moveUp}
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
                  {ROW.moveDown}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={`${MENU_ITEM} text-hub-danger hover:bg-hub-danger-tint`}
                  onClick={() => {
                    setMenuFor(null);
                    setConfirm(r);
                  }}
                >
                  {ROW.delete}
                </button>
              </li>
            </ul>
          ) : null}
        </div>
      </div>
    );
  }

  const page = data.page;
  let pageLine: ReactNode = null;
  if (page && "deleted" in page) {
    pageLine = (
      <p className="text-sm text-hub-ink-muted">
        {PAGE_LINE.deleted}{" "}
        <Link
          href="/hub/website"
          className="text-hub-accent underline underline-offset-2"
        >
          {PAGE_LINE.deletedLink}
        </Link>
      </p>
    );
  } else if (page) {
    pageLine = (
      <p className="text-sm text-hub-ink-muted">
        {PAGE_LINE.prefix} /{page.slug}
        {page.url ? (
          <>
            {" · "}
            <a
              href={page.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={PAGE_LINE.viewLabel}
              className="text-hub-accent underline underline-offset-2"
            >
              {PAGE_LINE.view}
            </a>
          </>
        ) : null}
        {" · "}
        {navState === "in" ? (
          <>
            {PAGE_LINE.navIn}
            {" · "}
            <Link
              href={PAGE_LINE.navArrangeHref}
              className="text-hub-accent underline underline-offset-2"
            >
              {PAGE_LINE.navArrange}
            </Link>
          </>
        ) : (
          <button
            type="button"
            onClick={addToNav}
            disabled={navBusy}
            aria-busy={navBusy || undefined}
            className="cursor-pointer text-hub-accent underline underline-offset-2 disabled:cursor-wait disabled:opacity-60"
          >
            {PAGE_LINE.navAdd}
          </button>
        )}
      </p>
    );
    if (navState === "full" || navError) {
      pageLine = (
        <>
          {pageLine}
          <InlineAlert
            tone={navError ? "error" : "warning"}
            action={
              navError ? undefined : (
                <Link
                  href={PAGE_LINE.navArrangeHref}
                  className="font-semibold text-hub-accent underline underline-offset-4"
                >
                  {PAGE_LINE.navArrange}
                </Link>
              )
            }
          >
            {navError ?? NAV_COPY.limit}
          </InlineAlert>
        </>
      );
    }
  }

  // One notice, by priority: scan hold, nothing shown, then expiring.
  let notice: ReactNode = null;
  if (heldCount > 0) {
    notice = <InlineAlert tone="warning">{heldNotice(heldCount)}</InlineAlert>;
  } else if (records.length > 0 && shown === 0) {
    notice = <InlineAlert tone="info">{NOTHING_SHOWN}</InlineAlert>;
  } else if (expiring.length > 0) {
    notice = (
      <InlineAlert tone="warning">
        {EXPIRING.lead(expiring.length)}{" "}
        {expiring.map((r, i) => (
          <Fragment key={r.id}>
            {i > 0 ? ", " : null}
            <button
              type="button"
              aria-label={EXPIRING.openLabel(titleOf(r))}
              onClick={() => openDrawer(r.id)}
              className="font-semibold underline underline-offset-2"
            >
              {titleOf(r)}
            </button>{" "}
            ({formatDayMonth(r.values.expires_on)})
          </Fragment>
        ))}
        . {EXPIRING.tail}
      </InlineAlert>
    );
  }

  const empty = records.length === 0;

  return (
    <section
      aria-label={data.name}
      className="flex max-w-[1120px] flex-col gap-4 font-hub text-hub-ink"
    >
      <AddonTabHeader
        heading={TAB.heading}
        countLine={countLine(records.length, shown)}
        helpLabel={TAB.help}
        onHelp={() => setTraining(true)}
        plural={data.plural}
        primary={
          empty ? null : { label: TAB.add, onClick: () => openDrawer("new") }
        }
        onImport={openImport}
        menu={[
          { label: TAB.exportCsv, onSelect: () => void exportCsv() },
          { label: TAB.template, onSelect: () => void template() },
          { label: TAB.backups, onSelect: () => setBackups(true) },
        ]}
      />
      {pageLine}
      {notice}
      {empty ? (
        <EmptyState
          heading={EMPTY.heading}
          body={EMPTY.body}
          action={
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary" onClick={() => openDrawer("new")}>
                  {EMPTY.add}
                </Button>
                {openImport ? (
                  <Button
                    variant="secondary"
                    onClick={openImport}
                    icon={<Upload aria-hidden size={16} strokeWidth={2} />}
                  >
                    {EMPTY.import}
                  </Button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setTraining(true)}
                  className="min-h-10 rounded px-2 text-sm text-hub-accent underline underline-offset-2"
                >
                  {EMPTY.how}
                </button>
              </div>
              <p className="text-sm text-hub-ink-muted">{EMPTY.helper}</p>
            </div>
          }
        />
      ) : (
        <RecordList<AddonRecordView>
          items={records}
          label={titleOf}
          noun={TAB.noun}
          listLabel={TAB.listLabel}
          groupOf={groupOf}
          onReorder={reorder}
          renderRow={renderRow}
        />
      )}

      {drawerOpen ? (
        <CredentialDrawer
          key={editing ? editing.id : "new"}
          open
          record={editing}
          groups={groups}
          onSave={actions.save}
          onSaved={(res) => {
            closeDrawer();
            toast.show({ message: res.held ? TOAST.held : TOAST.saved });
            router.refresh();
          }}
          onClose={closeDrawer}
        />
      ) : null}

      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm ? DELETE.title(titleOf(confirm)) : ""}
        footer={
          <>
            <Button
              variant="destructive"
              loading={deleting}
              onClick={() => void doDelete()}
            >
              {DELETE.confirm}
            </Button>
            <Button variant="ghost" autoFocus onClick={() => setConfirm(null)}>
              {DELETE.keep}
            </Button>
          </>
        }
      >
        <p>{DELETE.body}</p>
      </Dialog>

      <TrainingDrawer
        open={training}
        onClose={() => setTraining(false)}
        title={data.trainingTitle}
        steps={data.trainingSteps}
      />

      {data.csvEnabled ? (
        <CsvImportDialog
          open={importing}
          onClose={() => setImporting(false)}
          title={TAB.importTitle}
          singular={data.singular}
          plural={data.plural}
          onPreview={actions.importPreview}
          onCommit={actions.importCommit}
          onTemplate={() => void template()}
          onDone={imported}
        />
      ) : null}

      <BackupsPanel
        open={backups}
        onClose={() => setBackups(false)}
        plural={data.plural}
        singular={data.singular}
        list={actions.listBackups}
        save={actions.saveBackup}
        restore={actions.restoreBackup}
        onRestored={() => router.refresh()}
      />
    </section>
  );
}

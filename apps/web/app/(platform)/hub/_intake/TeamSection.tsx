"use client";
// Team list (06-20; 06-UI-SPEC "Team, Services › Team", "Destructive actions"; ONB-13,
// D120, D257, D-UI-P6-20). Reused by setup step "People & proof" and Settings › Team & hours
// (06-22): the host passes the list, readOnly and the context (setup titles it "Your team").
//   - Header (P5 AddonTabHeader): count line, Add a team member (hidden while empty, R2),
//     Import, and a More menu with Export CSV and the template. No Backups panel in P6.
//   - Rows (RecordList: drag, keyboard, Move up / down): photo or initials, name over role,
//     Hidden badge, Show on site switch (optimistic, snaps back), overflow Edit / Move up /
//     Move down / Remove from team.
//   - Remove asks first (a live list once the site exists); Keep team member is focused.
//   - The drawer is URL-held (?record=team-<id>|team-new).
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
import type { TeamMemberView } from "../../../../lib/intake";
import {
  commitCoreImportAction,
  exportCoreCsvAction,
  previewCoreImportAction,
  removeTeamMemberAction,
  reorderTeamAction,
  setTeamPublishedAction,
  templateCoreCsvAction,
} from "../../../actions/core-lists";
import {
  download,
  initials,
  useRecordParam,
  type ListContext,
} from "./list-helpers";
import { TeamDrawer } from "./TeamDrawer";

export const TEAM_COPY = {
  heading: { setup: "Your team", settings: "Team", website: "Team" },
  add: "Add a team member",
  importTitle: "Import team members",
  exportCsv: "Export CSV",
  template: "Download the template",
  listLabel: "Your team",
  noun: "team member",
  singular: "team member",
  plural: "team members",
  emptyHeading: "No team members yet",
  emptyBody:
    "Add the people customers will meet. They can show on an Our Team section of your site.",
  emptyImport: "Import from a spreadsheet",
  emptyHelper:
    "Just you? Add yourself, or leave this empty and your site won't show a team section.",
  hidden: "Hidden",
  showOnSite: "Show on site",
  showLabel: (name: string) => `Show ${name} on site`,
  moreLabel: (name: string) => `More actions for ${name}`,
  menuLabel: (name: string) => `Actions for ${name}`,
  edit: "Edit",
  moveUp: "Move up",
  moveDown: "Move down",
  remove: "Remove from team",
  removeTitle: (name: string) => `Remove ${name} from your team?`,
  removeBody:
    "They won't show on your site. This doesn't affect anyone's sign-in.",
  keep: "Keep team member",
  saved: "Team member saved.",
  /** 13-52 (D270): the records held line (testimonials / credentials TOAST.held). */
  held: "Saved. It shows on your site once it's reviewed, usually within 2 business days.",
  removed: (name: string) => `${name} removed from your team.`,
  toggleFailed: "That change didn't save. Try again.",
  reorderFailed: "That move didn't save, so the list went back. Try again.",
  exported: (n: number) =>
    `Exported ${n} ${n === 1 ? "team member" : "team members"}.`,
  imported: (added: number, updated: number) =>
    `Imported. ${added} added, ${updated} updated.`,
} as const;

/** "3 team members · 2 shown on your site" */
export function teamCountLine(total: number, shown: number): string {
  return `${total} ${total === 1 ? "team member" : "team members"} · ${shown} shown on your site`;
}

const MENU_ITEM =
  "flex min-h-10 w-full items-center gap-2 rounded px-3 text-left text-sm text-hub-ink " +
  "transition-colors duration-150 hover:bg-hub-surface-2 disabled:cursor-not-allowed " +
  "disabled:opacity-50 pointer-coarse:min-h-11";

export interface TeamSectionProps {
  data: TeamMemberView[];
  readOnly: boolean;
  context: ListContext;
  /** After any saved change (setup marks the step saved). */
  onChanged?: () => void;
}

export function TeamSection({
  data,
  readOnly,
  context,
  onChanged,
}: TeamSectionProps) {
  const router = useRouter();
  const toast = useToast();
  const drawer = useRecordParam("team");
  const [list, setList] = useState(data);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<TeamMemberView | null>(null);
  const [removing, setRemoving] = useState(false);
  const [importing, setImporting] = useState(false);
  useEffect(() => setList(data), [data]);

  const shown = list.filter((m) => m.is_published).length;
  const empty = list.length === 0;
  const editing =
    drawer.value && drawer.value !== "new"
      ? (list.find((m) => m.id === drawer.value) ?? null)
      : null;
  const drawerOpen = !readOnly && (drawer.value === "new" || editing !== null);
  const headingId = `team-heading-${context}`;

  function changed() {
    onChanged?.();
    router.refresh();
  }

  async function toggle(m: TeamMemberView, next: boolean) {
    setList((l) =>
      l.map((x) => (x.id === m.id ? { ...x, is_published: next } : x)),
    );
    const res = await setTeamPublishedAction(m.id, next).catch(() => null);
    if (!res || !res.ok) {
      setList((l) =>
        l.map((x) => (x.id === m.id ? { ...x, is_published: !next } : x)),
      );
      toast.show({ message: TEAM_COPY.toggleFailed });
      return;
    }
    if (res.data.held) {
      setList((l) =>
        l.map((x) => (x.id === m.id ? { ...x, is_published: false } : x)),
      );
      toast.show({ message: TEAM_COPY.held });
    }
    changed();
  }

  async function reorder(ids: string[]): Promise<boolean> {
    const res = await reorderTeamAction(ids).catch(() => null);
    if (!res || !res.ok) {
      toast.show({ message: TEAM_COPY.reorderFailed });
      return false;
    }
    setList((l) =>
      ids
        .map((id) => l.find((m) => m.id === id))
        .filter((m): m is TeamMemberView => m !== undefined),
    );
    changed();
    return true;
  }

  async function doRemove() {
    const m = confirm;
    if (!m) return;
    setRemoving(true);
    const res = await removeTeamMemberAction(m.id).catch(() => null);
    setRemoving(false);
    setConfirm(null);
    if (!res || !res.ok) {
      toast.show({
        message: res && !res.ok ? res.message : TEAM_COPY.toggleFailed,
      });
      return;
    }
    setList((l) => l.filter((x) => x.id !== m.id));
    toast.show({ message: TEAM_COPY.removed(m.name) });
    if (drawer.value === m.id) drawer.close();
    changed();
  }

  async function exportCsv() {
    const res = await exportCoreCsvAction("team_members").catch(() => null);
    if (!res || !res.ok) {
      toast.show({
        message: res && !res.ok ? res.message : TEAM_COPY.toggleFailed,
      });
      return;
    }
    download(res.data);
    toast.show({ message: TEAM_COPY.exported(list.length) });
  }

  async function template() {
    const res = await templateCoreCsvAction("team_members").catch(() => null);
    if (!res || !res.ok) {
      toast.show({
        message: res && !res.ok ? res.message : TEAM_COPY.toggleFailed,
      });
      return;
    }
    download(res.data);
  }

  function imported(result: ImportCommitResult) {
    toast.show({ message: TEAM_COPY.imported(result.added, result.updated) });
    changed();
  }

  const openImport = readOnly ? undefined : () => setImporting(true);

  function renderRow(m: TeamMemberView, handle: RecordMoveHandle) {
    const menuOpen = menuFor === m.id;
    const menuId = `team-menu-${m.id}`;
    return (
      <div className="flex min-h-16 min-w-0 flex-1 flex-col gap-2 py-3 md:flex-row md:items-center md:gap-4">
        <button
          type="button"
          disabled={readOnly}
          onClick={() => drawer.open(m.id)}
          className={`flex min-w-0 flex-1 items-center gap-3 rounded text-left disabled:cursor-default ${m.is_published ? "" : "opacity-60"}`}
        >
          {m.photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- private /hub/media route
            <img
              src={m.photo.thumbUrl}
              alt=""
              width={40}
              height={40}
              className="size-10 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-hub-surface-2 text-sm font-semibold text-hub-ink"
            >
              {initials(m.name)}
            </span>
          )}
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-base font-semibold text-hub-ink">
              {m.name}
            </span>
            {m.role ? (
              <span className="truncate text-sm text-hub-ink-muted">
                {m.role}
              </span>
            ) : null}
          </span>
        </button>
        <div className="relative flex flex-wrap items-center gap-2">
          {!m.is_published ? (
            <Badge tone="hidden">{TEAM_COPY.hidden}</Badge>
          ) : null}
          <Switch
            id={`team-shown-${m.id}`}
            label={TEAM_COPY.showOnSite}
            aria-label={TEAM_COPY.showLabel(m.name)}
            checked={m.is_published}
            disabled={readOnly}
            onChange={(v) => void toggle(m, v)}
          />
          {readOnly ? null : (
            <IconButton
              size="sm"
              label={TEAM_COPY.moreLabel(m.name)}
              tooltipAlign="end"
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? menuId : undefined}
              onClick={() => setMenuFor(menuOpen ? null : m.id)}
              icon={<MoreHorizontal aria-hidden size={16} strokeWidth={2} />}
            />
          )}
          {menuOpen ? (
            <ul
              id={menuId}
              aria-label={TEAM_COPY.menuLabel(m.name)}
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
                    drawer.open(m.id);
                  }}
                >
                  {TEAM_COPY.edit}
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
                  {TEAM_COPY.moveUp}
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
                  {TEAM_COPY.moveDown}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={`${MENU_ITEM} text-hub-danger hover:bg-hub-danger-tint`}
                  onClick={() => {
                    setMenuFor(null);
                    setConfirm(m);
                  }}
                >
                  {TEAM_COPY.remove}
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
        heading={TEAM_COPY.heading[context]}
        headingId={headingId}
        countLine={teamCountLine(list.length, shown)}
        plural={TEAM_COPY.plural}
        primary={
          empty || readOnly
            ? null
            : { label: TEAM_COPY.add, onClick: () => drawer.open("new") }
        }
        onImport={openImport}
        menu={[
          ...(empty
            ? []
            : [
                {
                  label: TEAM_COPY.exportCsv,
                  onSelect: () => void exportCsv(),
                },
              ]),
          { label: TEAM_COPY.template, onSelect: () => void template() },
        ]}
      />
      {empty ? (
        <EmptyState
          heading={TEAM_COPY.emptyHeading}
          body={TEAM_COPY.emptyBody}
          action={
            readOnly ? null : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="primary" onClick={() => drawer.open("new")}>
                    {TEAM_COPY.add}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setImporting(true)}
                    icon={<Upload aria-hidden size={16} strokeWidth={2} />}
                  >
                    {TEAM_COPY.emptyImport}
                  </Button>
                </div>
                <p className="text-sm text-hub-ink-muted">
                  {TEAM_COPY.emptyHelper}
                </p>
              </div>
            )
          }
        />
      ) : (
        <RecordList<TeamMemberView>
          items={list}
          label={(m) => m.name}
          noun={TEAM_COPY.noun}
          listLabel={TEAM_COPY.listLabel}
          onReorder={reorder}
          renderRow={renderRow}
          readOnly={readOnly}
        />
      )}

      {drawerOpen ? (
        <TeamDrawer
          key={editing ? editing.id : "new"}
          member={editing}
          onSaved={(saved, held) => {
            setList((l) =>
              l.some((x) => x.id === saved.id)
                ? l.map((x) => (x.id === saved.id ? saved : x))
                : [...l, saved],
            );
            drawer.close();
            toast.show({ message: held ? TEAM_COPY.held : TEAM_COPY.saved });
            changed();
          }}
          onClose={drawer.close}
        />
      ) : null}

      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm ? TEAM_COPY.removeTitle(confirm.name) : ""}
        footer={
          <>
            <Button
              variant="destructive"
              loading={removing}
              onClick={() => void doRemove()}
            >
              {TEAM_COPY.remove}
            </Button>
            <Button variant="ghost" autoFocus onClick={() => setConfirm(null)}>
              {TEAM_COPY.keep}
            </Button>
          </>
        }
      >
        <p>{TEAM_COPY.removeBody}</p>
      </Dialog>

      {readOnly ? null : (
        <CsvImportDialog
          open={importing}
          onClose={() => setImporting(false)}
          title={TEAM_COPY.importTitle}
          singular={TEAM_COPY.singular}
          plural={TEAM_COPY.plural}
          onPreview={(text, mode) =>
            previewCoreImportAction("team_members", text, mode)
          }
          onCommit={(text, mode, removals) =>
            commitCoreImportAction("team_members", text, mode, removals)
          }
          onTemplate={() => void template()}
          onDone={imported}
        />
      )}
    </section>
  );
}

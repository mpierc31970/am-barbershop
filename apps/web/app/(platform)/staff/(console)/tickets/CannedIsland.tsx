"use client";
// Canned replies island (13-41 choice 5; STAFF-09, D96, D119; 13-UI-SPEC "Canned replies tab"
// lines 513-523). SegmentedControl Active · Archived (URL `view=`), secondary New canned reply,
// a StaffTable (Title · First line · Updated), and a right Drawer form: Title (80), Reply
// (5,000, 10 rows) with PLACEHOLDER-HELP and four insert chips, a live PlaceholderPreview with
// sample values (Maria, Rivera Bakery, #1042, your first name), primary Save reply · ghost
// Discard; an existing reply also has Archive reply (immediate + Undo toast, 8 s) and an
// archived one Restore reply. No delete. Result toasts are the action lines.
import { BUSINESS_TIME_ZONE } from "@cds/core/payments";
import {
  CANNED_TOKENS,
  P13_COPY,
  fillCopy,
  type CannedVars,
} from "@cds/core/staff";
import {
  Button,
  Drawer,
  InlineAlert,
  SegmentedControl,
  TextArea,
  TextField,
  useToast,
} from "@cds/ui/hub";
import {
  PlaceholderPreview,
  StaffTable,
  useStaffAction,
  type StaffColumn,
} from "@cds/ui/staff";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import {
  archiveCannedAction,
  restoreCannedAction,
  saveCannedAction,
} from "../../../../actions/staff/canned";

export type CannedView = "active" | "archived";

export type CannedRowView = {
  id: string;
  title: string;
  body: string;
  archived: boolean;
  updated: string;
};

const TITLE_MAX = 80;
const BODY_MAX = 5000;

export const CANNED_TAB_COPY = {
  viewsLabel: "Show",
  views: { active: "Active", archived: "Archived" },
  newReply: "New canned reply",
  caption: "Canned replies, by title",
  cols: {
    title: "Title",
    firstLine: "First line",
    updated: "Updated",
    actions: "Actions",
  },
  empty: "No canned replies yet.",
  emptyArchived: "No archived replies.",
  formNew: "New canned reply",
  formEdit: "Edit canned reply",
  title: "Title",
  reply: "Reply",
  insert: (token: string) => `Insert {${token}}`,
  preview: "Owners see",
  save: "Save reply",
  saving: "Saving…",
  discard: "Discard",
  archive: "Archive reply",
  restore: "Restore reply",
  restoreRow: (title: string) => `Restore reply: ${title}`,
  titleNeeded: "Give the reply a title.",
  bodyNeeded: "Write the reply text.",
} as const;
const C = CANNED_TAB_COPY;

function listHref(view: CannedView, extra?: Record<string, string>): string {
  const q = new URLSearchParams({ tab: "canned" });
  if (view === "archived") q.set("view", "archived");
  for (const [k, v] of Object.entries(extra ?? {})) q.set(k, v);
  return `/staff/tickets?${q.toString()}`;
}

function firstLine(body: string): string {
  return body.split("\n").find((l) => l.trim() !== "") ?? "";
}

function dayText(iso: string): string {
  const d = new Date(iso.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: BUSINESS_TIME_ZONE,
  }).format(d);
}

function CannedDrawer({
  reply,
  open,
  onClose,
  sampleVars,
  onArchived,
}: {
  reply: CannedRowView | null;
  open: boolean;
  onClose(): void;
  sampleVars: CannedVars;
  onArchived(reply: CannedRowView): void;
}) {
  const id = useId();
  const router = useRouter();
  const toast = useToast();
  const save = useStaffAction(saveCannedAction);
  const restore = useStaffAction(restoreCannedAction);
  const [title, setTitle] = useState(reply?.title ?? "");
  const [body, setBody] = useState(reply?.body ?? "");
  const [errors, setErrors] = useState<{ title?: string; body?: string }>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const caret = useRef<{ start: number; end: number } | null>(null);
  const bodyId = `${id}-body`;

  function insertToken(token: string) {
    const el = document.getElementById(bodyId) as HTMLTextAreaElement | null;
    const sel =
      caret.current ??
      (el
        ? { start: el.selectionStart, end: el.selectionEnd }
        : { start: body.length, end: body.length });
    const text = `{${token}}`;
    const next = body.slice(0, sel.start) + text + body.slice(sel.end);
    setBody(next);
    const at = sel.start + text.length;
    caret.current = { start: at, end: at };
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at, at);
    });
  }

  async function submit() {
    const e = {
      title: title.trim() ? undefined : C.titleNeeded,
      body: body.trim() ? undefined : C.bodyNeeded,
    };
    setErrors(e);
    setRefusal(null);
    if (e.title || e.body) return;
    setPending(true);
    try {
      const res = await save({
        ...(reply ? { id: reply.id } : {}),
        title,
        body,
      });
      if (res.ok) {
        toast.show({ message: res.data.message });
        onClose();
        router.refresh();
      } else if (res.field === "title" || res.field === "body") {
        setErrors({ [res.field]: res.message });
      } else if (res.code !== "session_ended") {
        setRefusal(res.message);
      }
    } finally {
      setPending(false);
    }
  }

  async function doRestore() {
    if (!reply) return;
    const res = await restore(reply.id);
    if (res.ok) {
      toast.show({ message: res.data.message });
      onClose();
      router.refresh();
    } else if (res.code !== "session_ended") {
      setRefusal(res.message);
    }
  }

  const heading = reply ? C.formEdit : C.formNew;
  return (
    <Drawer open={open} onClose={onClose} label={heading} side="right">
      <form
        noValidate
        data-canned-form={reply?.id ?? "new"}
        className="flex flex-col gap-6 p-6 font-hub text-hub-ink"
        onSubmit={(ev) => {
          ev.preventDefault();
          void submit();
        }}
      >
        <h2 className="text-xl font-semibold">{heading}</h2>
        <TextField
          id={`${id}-title`}
          label={C.title}
          value={title}
          maxLength={TITLE_MAX}
          counter={{ value: title.trim().length, max: TITLE_MAX }}
          onChange={(ev) => setTitle(ev.target.value)}
          error={errors.title}
        />
        <div className="flex flex-col gap-2">
          <TextArea
            id={bodyId}
            label={C.reply}
            helper={P13_COPY.PLACEHOLDER_HELP}
            rows={10}
            value={body}
            maxLength={BODY_MAX}
            counter={{ value: body.length, max: BODY_MAX }}
            onChange={(ev) => {
              setBody(ev.target.value);
              caret.current = null;
            }}
            onSelect={(ev) => {
              const t = ev.currentTarget;
              caret.current = { start: t.selectionStart, end: t.selectionEnd };
            }}
            error={errors.body}
          />
          <div className="flex flex-wrap gap-2">
            {CANNED_TOKENS.map((t) => (
              <Button
                key={t}
                type="button"
                variant="ghost"
                size="sm"
                aria-label={C.insert(t)}
                onClick={() => insertToken(t)}
              >
                {`{${t}}`}
              </Button>
            ))}
          </div>
        </div>
        {body.trim() ? (
          <PlaceholderPreview
            body={body}
            vars={sampleVars}
            timeZone={BUSINESS_TIME_ZONE}
            label={C.preview}
          />
        ) : null}
        {refusal ? <InlineAlert tone="error">{refusal}</InlineAlert> : null}
        <div className="flex flex-wrap gap-2">
          {reply?.archived ? (
            <Button
              type="button"
              variant="primary"
              onClick={() => void doRestore()}
            >
              {C.restore}
            </Button>
          ) : (
            <Button
              type="submit"
              variant="primary"
              loading={pending}
              loadingLabel={C.saving}
            >
              {C.save}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onClose}>
            {C.discard}
          </Button>
          {reply && !reply.archived ? (
            <Button
              type="button"
              variant="secondary"
              className="ml-auto"
              onClick={() => onArchived(reply)}
            >
              {C.archive}
            </Button>
          ) : null}
        </div>
      </form>
    </Drawer>
  );
}

export function CannedList({
  rows,
  view,
  agentName,
  openId,
  startNew = false,
}: {
  rows: readonly CannedRowView[];
  view: CannedView;
  agentName: string;
  /** `?edit=<id>`: open that reply's drawer on arrival. */
  openId?: string | null;
  /** `?new=1` (the picker's Add one link). */
  startNew?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const archive = useStaffAction(archiveCannedAction);
  const restore = useStaffAction(restoreCannedAction);
  const [editing, setEditing] = useState<CannedRowView | "new" | null>(() => {
    if (startNew) return "new";
    return rows.find((r) => r.id === openId) ?? null;
  });
  const [drawerKey, setDrawerKey] = useState(0);
  const sampleVars: CannedVars = {
    first_name: "Maria",
    business: "Rivera Bakery",
    ticket: 1042,
    agent: agentName || "CDS",
  };

  function open(next: CannedRowView | "new") {
    setEditing(next);
    setDrawerKey((k) => k + 1);
  }

  async function doRestore(r: CannedRowView) {
    const res = await restore(r.id);
    if (res.ok) {
      toast.show({ message: res.data.message });
      router.refresh();
    } else if (res.code !== "session_ended") {
      toast.show({ message: res.message });
    }
  }

  async function doArchive(r: CannedRowView) {
    const res = await archive(r.id);
    if (!res.ok) {
      if (res.code !== "session_ended") toast.show({ message: res.message });
      return;
    }
    setEditing(null);
    router.refresh();
    toast.show({
      message: fillCopy(P13_COPY.UNDO_ARCHIVED, { title: r.title }),
      action: {
        label: P13_COPY.UNDO,
        onClick: () => void doRestore(r),
      },
    });
  }

  const columns: StaffColumn<CannedRowView>[] = [
    {
      id: "title",
      header: C.cols.title,
      cell: (r) => r.title,
      priority: 1,
      primary: true,
    },
    {
      id: "first",
      header: C.cols.firstLine,
      cell: (r) => (
        <span className="line-clamp-1 text-hub-ink-muted">
          {firstLine(r.body)}
        </span>
      ),
      priority: 2,
    },
    {
      id: "updated",
      header: C.cols.updated,
      cell: (r) => dayText(r.updated),
      priority: 3,
      nowrap: true,
    },
    ...(view === "archived"
      ? [
          {
            id: "actions",
            header: C.cols.actions,
            cell: (r: CannedRowView) => (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                aria-label={C.restoreRow(r.title)}
                onClick={() => void doRestore(r)}
              >
                {C.restore}
              </Button>
            ),
            priority: 1 as const,
            align: "end" as const,
            stack: true,
          },
        ]
      : []),
  ];

  return (
    <div
      className="flex flex-col gap-4 font-hub text-hub-ink"
      data-canned-tab=""
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <SegmentedControl
          name="canned-view"
          label={C.viewsLabel}
          options={[
            { value: "active", label: C.views.active },
            { value: "archived", label: C.views.archived },
          ]}
          value={view}
          onChange={(v) => router.push(listHref(v))}
        />
        <Button type="button" variant="secondary" onClick={() => open("new")}>
          {C.newReply}
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="py-6 text-base text-hub-ink-muted">
          {view === "archived" ? C.emptyArchived : C.empty}
        </p>
      ) : (
        <StaffTable
          caption={C.caption}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          rowLabel={(r) => r.title}
          primaryHref={(r) => listHref(view, { edit: r.id })}
          onPrimaryClick={(r, e) => {
            e.preventDefault();
            open(r);
          }}
          shortcutsEnabled={false}
        />
      )}
      {editing !== null ? (
        <CannedDrawer
          key={drawerKey}
          reply={editing === "new" ? null : editing}
          open
          onClose={() => setEditing(null)}
          sampleVars={sampleVars}
          onArchived={(r) => void doArchive(r)}
        />
      ) : null}
    </div>
  );
}

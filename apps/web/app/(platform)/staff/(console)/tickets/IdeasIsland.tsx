"use client";
// Ideas island (13-36 choices 3-4; P12 `ideas:run` in the console; 13-UI-SPEC "Ideas" lines
// 587-596). SegmentedControl Suggested · Considering · Planned · Built · Hidden · Merged (URL
// `view=`) over a StaffTable (Title · Status · Votes · Suggested by · Ticket · Suggested). A row
// opens the right Drawer (`open=<id>`): Title / Description + Save idea; Status select + Set
// status (Built → CaseDialog "Mark "Gift cards" Built? 7 sites that voted get an alert."); Merge
// into + Merge… → CaseDialog "Merge "X" into "Y"?" (Merge ideas · Keep separate); ghost Hide
// idea / Unhide idea. Result toasts are the CLI lines. Row types mirror the @cds/db read model.
import { BUSINESS_TIME_ZONE } from "@cds/core/payments";
import { fillCopy, P13_DIALOGS } from "@cds/core/staff";
import {
  Badge,
  Button,
  Drawer,
  InlineAlert,
  SegmentedControl,
  Select,
  TextArea,
  TextField,
  useToast,
  type BadgeTone,
} from "@cds/ui/hub";
import {
  CaseDialog,
  compactAge,
  IDEAS_COPY,
  StaffTable,
  useStaffAction,
  type StaffColumn,
} from "@cds/ui/staff";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import {
  editIdeaAction,
  hideIdeaAction,
  ideaStatusAction,
  mergeIdeasAction,
  unhideIdeaAction,
} from "../../../../actions/staff/ideas";

const C = IDEAS_COPY;
export const IDEA_VIEWS = [
  "suggested",
  "considering",
  "planned",
  "built",
  "hidden",
  "merged",
] as const;
export type IdeaView = (typeof IDEA_VIEWS)[number];
type Status = "suggested" | "considering" | "planned" | "built";
const STATUSES: readonly Status[] = [
  "suggested",
  "considering",
  "planned",
  "built",
];
const TONE: Record<Status, BadgeTone> = {
  suggested: "i-suggested",
  considering: "i-considering",
  planned: "i-planned",
  built: "i-built",
};
const TITLE_MAX = 80;
const DESCRIPTION_MAX = 2000;

export type IdeaRowView = {
  id: string;
  title: string;
  description: string;
  status: Status;
  votes: number;
  created: string;
  hidden: boolean;
  heldForReview: boolean;
  merged: boolean;
  business: string;
  ticket: number | null;
};

function href(view: IdeaView, open?: string): string {
  const q = new URLSearchParams({ tab: "ideas" });
  if (view !== "suggested") q.set("view", view);
  if (open) q.set("open", open);
  return `/staff/tickets?${q.toString()}`;
}

function ago(iso: string, now: string): string {
  const from = new Date(iso.replace(" ", "T"));
  if (Number.isNaN(from.getTime())) return C.none;
  return compactAge(from, new Date(now), BUSINESS_TIME_ZONE);
}

function StateBadge({ row }: { row: IdeaRowView }) {
  if (row.merged) return <Badge tone="hidden">{C.merged}</Badge>;
  if (row.hidden) {
    return (
      <Badge tone="hidden">
        {row.heldForReview ? C.heldForReview : C.hidden}
      </Badge>
    );
  }
  return <Badge tone={TONE[row.status]}>{C.views[row.status]}</Badge>;
}

export function IdeasList({
  rows,
  view,
  now,
}: {
  rows: readonly IdeaRowView[];
  view: IdeaView;
  now: string;
}) {
  const router = useRouter();
  const columns: StaffColumn<IdeaRowView>[] = [
    {
      id: "title",
      header: C.cols.title,
      cell: (r) => r.title,
      priority: 1,
      primary: true,
    },
    {
      id: "status",
      header: C.cols.status,
      cell: (r) => <StateBadge row={r} />,
      priority: 1,
      stack: true,
    },
    {
      id: "votes",
      header: C.cols.votes,
      cell: (r) => <span className="tabular-nums">{r.votes}</span>,
      priority: 1,
      align: "end",
    },
    {
      id: "site",
      header: C.cols.site,
      cell: (r) => r.business || C.none,
      priority: 3,
    },
    {
      id: "ticket",
      header: C.cols.ticket,
      cell: (r) => (r.ticket ? `#${r.ticket}` : C.none),
      priority: 4,
      nowrap: true,
    },
    {
      id: "created",
      header: C.cols.created,
      cell: (r) => `${ago(r.created, now)} ago`,
      priority: 3,
      nowrap: true,
    },
  ];
  return (
    <div className="flex flex-col gap-4 font-hub text-hub-ink">
      <SegmentedControl
        name="idea-view"
        label={C.viewsLabel}
        options={IDEA_VIEWS.map((v) => ({ value: v, label: C.views[v] }))}
        value={view}
        onChange={(v) => router.push(href(v))}
      />
      {rows.length === 0 ? (
        <p className="py-6 text-base text-hub-ink-muted">{C.empty}</p>
      ) : (
        <StaffTable
          caption={C.caption}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          rowLabel={(r) => r.title}
          primaryHref={(r) => href(view, r.id)}
          shortcutsEnabled={false}
        />
      )}
    </div>
  );
}

export function IdeaDrawer({
  idea,
  mergeTargets,
  view,
}: {
  idea: IdeaRowView;
  /** Ideas this one may merge into (not merged, not itself). */
  mergeTargets: readonly { id: string; title: string; votes: number }[];
  view: IdeaView;
}) {
  const id = useId();
  const router = useRouter();
  const toast = useToast();
  const edit = useStaffAction(editIdeaAction);
  const setStatus = useStaffAction(ideaStatusAction);
  const merge = useStaffAction(mergeIdeasAction);
  const hide = useStaffAction(hideIdeaAction);
  const unhide = useStaffAction(unhideIdeaAction);
  const [title, setTitle] = useState(idea.title);
  const [description, setDescription] = useState(idea.description);
  const [status, setStatusValue] = useState<Status>(idea.status);
  const [into, setInto] = useState("");
  const [confirm, setConfirm] = useState<"built" | "merge" | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const close = () => router.push(href(view));

  function done(res: {
    ok: boolean;
    code?: string;
    message?: string;
    data?: unknown;
  }) {
    if (res.ok) {
      const msg = (res.data as { message?: string } | undefined)?.message;
      if (msg) toast.show({ message: msg });
      router.refresh();
    } else if (res.code !== "session_ended" && res.code !== "step_up_needed") {
      setRefusal(res.message ?? "");
    }
  }

  async function save() {
    setRefusal(null);
    const change: { title?: string; description?: string } = {};
    if (title.trim() !== idea.title) change.title = title;
    if (description.trim() !== idea.description)
      change.description = description;
    setSaving(true);
    try {
      done(await edit(idea.id, change));
    } finally {
      setSaving(false);
    }
  }

  const target = mergeTargets.find((m) => m.id === into);
  const built = P13_DIALOGS.idea_built;
  const mergeDialog = P13_DIALOGS.ideas_merge;

  return (
    <Drawer open onClose={close} label={C.detail} side="right">
      <div className="flex flex-col gap-6 p-6 font-hub text-hub-ink">
        <header className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold">{idea.title}</h2>
          <StateBadge row={idea} />
          <span className="text-sm text-hub-ink-muted tabular-nums">
            {C.votes(idea.votes)}
          </span>
        </header>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(ev) => {
            ev.preventDefault();
            void save();
          }}
        >
          <TextField
            id={`${id}-title`}
            label={C.title}
            value={title}
            counter={{ value: title.trim().length, max: TITLE_MAX }}
            onChange={(ev) => setTitle(ev.target.value)}
          />
          <TextArea
            id={`${id}-description`}
            label={C.description}
            rows={5}
            value={description}
            counter={{ value: description.trim().length, max: DESCRIPTION_MAX }}
            onChange={(ev) => setDescription(ev.target.value)}
          />
          <div>
            <Button
              type="submit"
              variant="secondary"
              loading={saving}
              loadingLabel={C.saving}
            >
              {C.save}
            </Button>
          </div>
        </form>

        {idea.merged ? (
          <p className="text-sm text-hub-ink-muted">{C.mergedNote}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-48 flex-1">
                <Select
                  id={`${id}-status`}
                  label={C.status}
                  value={status}
                  onChange={(ev) => setStatusValue(ev.target.value as Status)}
                  options={STATUSES.map((s) => ({
                    value: s,
                    label: C.views[s],
                  }))}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={status === idea.status}
                onClick={async () => {
                  setRefusal(null);
                  if (status === "built") setConfirm("built");
                  else done(await setStatus(idea.id, status));
                }}
              >
                {C.setStatus}
              </Button>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-48 flex-1">
                <Select
                  id={`${id}-into`}
                  label={C.mergeInto}
                  value={into}
                  onChange={(ev) => setInto(ev.target.value)}
                  options={[
                    { value: "", label: C.mergePlaceholder },
                    ...mergeTargets.map((m) => ({
                      value: m.id,
                      label: m.title,
                    })),
                  ]}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={!target}
                onClick={() => {
                  setRefusal(null);
                  setConfirm("merge");
                }}
              >
                {C.merge}
              </Button>
            </div>
            <div>
              <Button
                type="button"
                variant="ghost"
                onClick={async () => {
                  setRefusal(null);
                  done(await (idea.hidden ? unhide(idea.id) : hide(idea.id)));
                }}
              >
                {idea.hidden ? C.unhide : C.hide}
              </Button>
            </div>
          </>
        )}
        {refusal ? <InlineAlert tone="error">{refusal}</InlineAlert> : null}
        <div className="border-t border-hub-border pt-4">
          <Button type="button" variant="ghost" onClick={close}>
            {C.close}
          </Button>
        </div>
      </div>
      {confirm === "built" ? (
        <CaseDialog
          open
          onClose={() => setConfirm(null)}
          title={fillCopy(built.title, { idea: idea.title })}
          consequence={fillCopy(built.body, { count: idea.votes })}
          caseRows={[
            [C.title, idea.title],
            [C.cols.votes, String(idea.votes)],
          ]}
          confirmLabel={built.confirm}
          safeLabel={built.safe}
          onConfirm={async () => {
            const res = await setStatus(idea.id, "built");
            if (res.ok) done(res);
            return res;
          }}
        />
      ) : null}
      {confirm === "merge" && target ? (
        <CaseDialog
          open
          onClose={() => setConfirm(null)}
          title={fillCopy(mergeDialog.title, {
            from: idea.title,
            into: target.title,
          })}
          consequence={`Votes ${idea.votes} + ${target.votes} combine. The duplicate leaves the board; a site that voted for both keeps one vote.`}
          caseRows={[
            [C.title, idea.title],
            [C.mergeInto, target.title],
          ]}
          confirmLabel={mergeDialog.confirm}
          safeLabel={mergeDialog.safe}
          onConfirm={async () => {
            const res = await merge(idea.id, target.id);
            if (res.ok) {
              toast.show({ message: res.data.message });
              router.push(href(view));
              router.refresh();
            }
            return res;
          }}
        />
      ) : null}
    </Drawer>
  );
}

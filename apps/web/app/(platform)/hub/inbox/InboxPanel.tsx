"use client";
// Inbox client panel (07-19; CONT-25, D231, D271, D311, D-UI-P7-20; 07-UI-SPEC "Inbox";
// choices 7-11; T-07-19-08, T-07-19-09). Wires the inbox actions into the @cds/ui inbox
// components. Owner-hub pattern (D311): list first, a drawer for the record, one primary per
// view (Reply by email in the drawer; the list has none).
//   - Form and search live in the URL (tab, form, q, message only). Filters replace it inside
//     a transition: the list dims and is aria-busy until the server answers.
//   - Load more fetches the next 50 through listMessagesAction and appends (choice 8). The
//     appended rows survive a router.refresh(); they reset when tab, form or search change.
//   - The drawer is URL-led on `message`: a row click opens it at once from the row and
//     replaces the URL; `?message=<id>` alone (07-16's contact history, 07-15's notification
//     email) opens it from the server's read. Either way the open is marked read here, once,
//     through openMessageAction (choice 7: never during the server render, so prefetching a
//     link cannot mark anything read), then router.refresh() drops the sidebar badge.
//   - Not spam, Delete and Mark as unread toast (choice 11), close the drawer and refresh.
//   - Reply by email is a mailto: from mailtoHref; View contact only for members who can
//     read contacts and only when the message has a contact (choice 10).
import {
  Button,
  EMPTY_INBOX,
  EmptyState,
  INBOX_COPY,
  INBOX_FILTERED_EMPTY,
  INBOX_GONE_COPY,
  INBOX_NO_MATCH,
  INBOX_TOASTS,
  InboxTable,
  InboxToolbar,
  InlineAlert,
  MessageDrawer,
  TrainingDrawer,
  buttonClasses,
  contactHref,
  useToast,
  type CsvFile,
  type HubActionResult,
  type InboxFilterPatch,
  type InboxFormOption,
  type MessageDetailView,
  type MessageRowView,
} from "@cds/ui/hub";
import { CircleHelp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  deleteMessageAction,
  exportMessagesAction,
  listMessagesAction,
  markNotSpamAction,
  openMessageAction,
  setMessageReadAction,
} from "../../../actions/inbox";
import { download } from "../_intake/list-helpers";
import { GuardedLink } from "../GuardedLink";
import { inboxHref, type InboxParams } from "./inbox-params";
import { INBOX_STEPS, INBOX_TITLE } from "./inbox-steps";

export interface InboxPanelProps {
  params: InboxParams;
  rows: MessageRowView[];
  page: number;
  totalPages: number;
  forms: InboxFormOption[];
  /** The server's read of `params.message` (not marked read), or null. */
  open: MessageDetailView | null;
  /** The message in the URL is gone (deleted, or not this org's). */
  gone: boolean;
  /** The form in the URL is gone; the list was read without it. */
  formGone: boolean;
  canWrite: boolean;
  canContacts: boolean;
  timeZone: string;
  siteName: string;
  /** The server's clock, so "Today" matches between the server render and hydration. */
  nowIso: string;
}

const FORMS_HREF = "/hub/website?tab=forms";

function listKey(p: InboxParams): string {
  return `${p.tab}|${p.form ?? ""}|${p.q ?? ""}`;
}

export function InboxPanel(props: InboxPanelProps) {
  const {
    params,
    rows,
    page,
    totalPages,
    forms,
    open,
    gone,
    formGone,
    canWrite,
    canContacts,
    timeZone,
    siteName,
    nowIso,
  } = props;
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const now = new Date(nowIso);

  // Load more (choice 8): extra pages appended under the server's first page.
  const key = listKey(params);
  const [seenKey, setSeenKey] = useState(key);
  const [extra, setExtra] = useState<MessageRowView[]>([]);
  const [pageNo, setPageNo] = useState(page);
  const [pages, setPages] = useState(totalPages);
  const [loadingMore, setLoadingMore] = useState(false);
  // Local read state and removals, so the list answers at once while the server catches up.
  const [readOverride, setReadOverride] = useState<Record<string, boolean>>({});
  const [removed, setRemoved] = useState<Record<string, true>>({});

  if (key !== seenKey) {
    setSeenKey(key);
    setExtra([]);
    setPageNo(page);
    setPages(totalPages);
    setReadOverride({});
    setRemoved({});
  }

  // The drawer: which message, its row (for the title) and its detail.
  const initialId = params.message && !gone ? params.message : null;
  const [openId, setOpenId] = useState<string | null>(initialId);
  const [openRow, setOpenRow] = useState<MessageRowView | null>(
    () => rows.find((r) => r.id === initialId) ?? null,
  );
  const [detail, setDetail] = useState<MessageDetailView | null>(null);
  const [seenMessage, setSeenMessage] = useState(params.message);
  const opened = useRef<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [training, setTraining] = useState(false);

  // The URL's message changed under us (Back, a link): follow it.
  if (params.message !== seenMessage) {
    setSeenMessage(params.message);
    const next = params.message && !gone ? params.message : null;
    if (next !== openId) {
      setOpenId(next);
      setDetail(null);
      setOpenRow(next ? (rows.find((r) => r.id === next) ?? null) : null);
    }
  }

  const merged: MessageRowView[] = [];
  const seenIds = new Set<string>();
  for (const r of [...rows, ...extra]) {
    if (seenIds.has(r.id) || removed[r.id]) continue;
    seenIds.add(r.id);
    const read = readOverride[r.id];
    merged.push(read === undefined ? r : { ...r, unread: !read });
  }

  function go(patch: Partial<InboxParams>): void {
    const href = inboxHref(params, patch);
    startTransition(() => router.replace(href, { scroll: false }));
  }

  // Mark read once per open (choice 7), then refresh so the sidebar badge drops. Re-runs on
  // a new params object are no-ops: `opened` holds the id already marked.
  useEffect(() => {
    if (!openId || opened.current === openId) return;
    opened.current = openId;
    const id = openId;
    void openMessageAction(id).then((res) => {
      if (opened.current !== id) return;
      if (res.ok) {
        setDetail(res.data);
        setReadOverride((m) => ({ ...m, [id]: true }));
        router.refresh();
      } else {
        toast.show({ message: res.message });
        opened.current = null;
        setOpenId(null);
        router.replace(inboxHref(params, { message: undefined }), {
          scroll: false,
        });
      }
    });
  }, [openId, params, router, toast]);

  function openMessage(row: MessageRowView): void {
    if (openId === row.id) return;
    opened.current = null;
    setOpenRow(row);
    setDetail(null);
    setOpenId(row.id);
    go({ message: row.id });
  }

  function closeDrawer(): void {
    opened.current = null;
    setOpenId(null);
    setOpenRow(null);
    setDetail(null);
    go({ message: undefined });
  }

  function onFilter(patch: InboxFilterPatch): void {
    const next: Partial<InboxParams> = { message: undefined };
    if ("form" in patch) next.form = patch.form ?? undefined;
    if ("q" in patch) next.q = patch.q ?? undefined;
    opened.current = null;
    setOpenId(null);
    setOpenRow(null);
    setDetail(null);
    go(next);
  }

  async function loadMore(): Promise<void> {
    if (loadingMore) return;
    setLoadingMore(true);
    const res = await listMessagesAction({
      view: params.tab,
      ...(params.form ? { form: params.form } : {}),
      ...(params.q ? { q: params.q } : {}),
      page: pageNo + 1,
    });
    setLoadingMore(false);
    if (!res.ok) {
      toast.show({ message: res.message });
      return;
    }
    setExtra((list) => [...list, ...res.data.items]);
    setPageNo(res.data.page);
    setPages(res.data.totalPages);
  }

  async function exportCsv(): Promise<void> {
    if (!params.form || exporting) return;
    setExporting(true);
    const res = await exportMessagesAction(params.form);
    setExporting(false);
    if (res.ok) download(res.data as CsvFile);
    else toast.show({ message: res.message });
  }

  async function afterWrite(
    res: HubActionResult<null>,
    id: string,
    message: string,
    effect: () => void,
  ): Promise<HubActionResult<null>> {
    if (res.ok) {
      effect();
      toast.show({ message });
      if (opened.current === id) closeDrawer();
      router.refresh();
    }
    return res;
  }

  // The open drawer's detail: this client's marked-read copy, else the server's read.
  const drawerDetail =
    openId === null
      ? null
      : detail && detail.id === openId
        ? detail
        : open && open.id === openId
          ? open
          : null;
  const drawerFrom =
    openRow && openRow.id === openId
      ? openRow.from
      : (merged.find((r) => r.id === openId)?.from ?? "");
  const filtered = Boolean(params.form || params.q);
  const empty = merged.length === 0;

  return (
    <section
      aria-label={params.tab === "filtered" ? "Filtered" : "Messages"}
      className="flex flex-col gap-6 font-hub text-hub-ink"
    >
      {gone || formGone ? (
        <InlineAlert tone="info">{INBOX_GONE_COPY}</InlineAlert>
      ) : null}

      {empty && !filtered ? (
        params.tab === "filtered" ? (
          <p className="rounded border border-dashed border-hub-border px-6 py-12 text-base text-hub-ink">
            {INBOX_FILTERED_EMPTY}
          </p>
        ) : (
          <EmptyState
            heading={EMPTY_INBOX.heading}
            body={EMPTY_INBOX.body}
            action={
              <GuardedLink
                href={FORMS_HREF}
                className={buttonClasses("secondary")}
              >
                {EMPTY_INBOX.link}
              </GuardedLink>
            }
          />
        )
      ) : (
        <>
          <InboxToolbar
            tab={params.tab}
            forms={forms}
            form={params.form}
            q={params.q}
            onChange={onFilter}
            onExport={() => void exportCsv()}
            exporting={exporting}
          />
          {empty ? (
            <div
              aria-busy={pending || undefined}
              className="flex flex-col items-start gap-3 rounded border border-dashed border-hub-border px-6 py-12"
            >
              <p className="text-base text-hub-ink">{INBOX_NO_MATCH}</p>
              <Button
                variant="ghost"
                onClick={() => onFilter({ form: null, q: null })}
              >
                {INBOX_COPY.clearFilters}
              </Button>
            </div>
          ) : (
            <InboxTable
              rows={merged}
              timeZone={timeZone}
              now={now}
              onOpen={openMessage}
              hasMore={pageNo < pages}
              onLoadMore={() => void loadMore()}
              loadingMore={loadingMore}
              busy={pending}
              openId={openId}
            />
          )}
        </>
      )}

      <div>
        <Button
          variant="ghost"
          icon={<CircleHelp aria-hidden size={16} strokeWidth={2} />}
          onClick={() => setTraining(true)}
        >
          {INBOX_TITLE}
        </Button>
      </div>

      {openId ? (
        <MessageDrawer
          key={openId}
          from={drawerFrom}
          detail={drawerDetail}
          canWrite={canWrite}
          timeZone={timeZone}
          siteName={siteName}
          contactHref={
            canContacts && drawerDetail?.contact
              ? contactHref(drawerDetail.contact)
              : null
          }
          LinkComponent={GuardedLink}
          onClose={closeDrawer}
          onNotSpam={async () => {
            const id = openId;
            return afterWrite(
              await markNotSpamAction(id),
              id,
              INBOX_TOASTS.notSpam,
              () => setRemoved((m) => ({ ...m, [id]: true })),
            );
          }}
          onMarkUnread={async () => {
            const id = openId;
            return afterWrite(
              await setMessageReadAction(id, false),
              id,
              INBOX_TOASTS.unread,
              () => setReadOverride((m) => ({ ...m, [id]: false })),
            );
          }}
          onDelete={async () => {
            const id = openId;
            return afterWrite(
              await deleteMessageAction(id),
              id,
              INBOX_TOASTS.deleted,
              () => setRemoved((m) => ({ ...m, [id]: true })),
            );
          }}
        />
      ) : null}

      <TrainingDrawer
        open={training}
        onClose={() => setTraining(false)}
        title={INBOX_TITLE}
        steps={INBOX_STEPS}
      />
    </section>
  );
}

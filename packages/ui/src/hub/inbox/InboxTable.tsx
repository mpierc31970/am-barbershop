// Inbox message list (07-19; CONT-25, D311; 07-UI-SPEC "Inbox" list, "Color" Unread,
// "Interaction states" Inbox). A real <table> at 768px and up: From (the button that opens
// the drawer) · Form · Preview (ink-muted) · Received (tabular). Below 768px the rows stack
// (from / form · received / preview). Rows are 56px. Unread rows set the sender in Body 600
// with an "Unread" badge (ink on #F2F2EF): a word, never colour alone. Newest first, 50 at a
// time; Load more (secondary) shows while more exist. While the first page loads, 5 skeleton
// rows. Every cell is React text: a visitor-typed name or answer never becomes markup.
// Server-safe: no hooks; opening and loading come in as callbacks.
// 14-35 (P14-P40): a launch-review test message shows a neutral "Test" badge beside the sender
// (sr text "Test message from your launch review"); it is never hidden and still counts.
import { Badge } from "../Badge";
import { Button } from "../Button";
import { Skeleton } from "../feedback";
import {
  INBOX_COPY,
  formLabel,
  receivedLabel,
  senderLabel,
  type MessageRowView,
} from "./copy";

export interface InboxTableProps {
  rows: readonly MessageRowView[];
  timeZone: string;
  /** "Today" is decided against this instant (the server's, so SSR and hydration agree). */
  now: Date;
  onOpen: (row: MessageRowView) => void;
  hasMore: boolean;
  onLoadMore: () => void;
  loadingMore?: boolean;
  /** The first page is loading: 5 skeleton rows. */
  loading?: boolean;
  /** Filters are loading: the list dims and is aria-busy. */
  busy?: boolean;
  /** The id of the message open in the drawer (aria-current on its row button). */
  openId?: string | null;
}

const TH = "px-4 py-3 text-left text-sm font-semibold text-hub-ink";

function FromButton({
  row,
  onOpen,
  current,
}: {
  row: MessageRowView;
  onOpen: (row: MessageRowView) => void;
  current: boolean;
}) {
  const label = senderLabel(row.from);
  return (
    <button
      type="button"
      data-message-open={row.id}
      aria-current={current || undefined}
      onClick={() => onOpen(row)}
      className={
        "max-w-full truncate rounded text-left text-base underline-offset-2 hover:underline " +
        "pointer-coarse:min-h-11 " +
        (row.unread ? "font-semibold text-hub-ink" : "font-normal text-hub-ink")
      }
    >
      {label}
    </button>
  );
}

function UnreadBadge({ unread }: { unread: boolean }) {
  return unread ? <Badge tone="unread">{INBOX_COPY.unread}</Badge> : null;
}

/** 14-35 (P14-P40): a launch-review test message. Neutral tone, a word, never hidden. */
function TestBadge({ isTest }: { isTest?: boolean }) {
  return isTest ? (
    <Badge tone="role" className="shrink-0">
      <span aria-hidden="true">{INBOX_COPY.test}</span>
      <span className="sr-only">{INBOX_COPY.testSr}</span>
    </Badge>
  ) : null;
}

export function InboxTable({
  rows,
  timeZone,
  now,
  onOpen,
  hasMore,
  onLoadMore,
  loadingMore = false,
  loading = false,
  busy = false,
  openId = null,
}: InboxTableProps) {
  if (loading) return <Skeleton rows={5} rowHeight={56} />;
  return (
    <div
      aria-busy={busy || undefined}
      className={
        "flex flex-col gap-4 font-hub transition-opacity duration-150 " +
        (busy ? "opacity-60" : "")
      }
    >
      <table className="hidden w-full table-fixed border-collapse md:table">
        <caption className="sr-only">Messages</caption>
        <colgroup>
          <col className="w-[28%]" />
          <col className="w-[18%]" />
          <col />
          <col className="w-36" />
        </colgroup>
        <thead className="border-b border-hub-border">
          <tr>
            <th scope="col" className={TH}>
              {INBOX_COPY.columns.from}
            </th>
            <th scope="col" className={TH}>
              {INBOX_COPY.columns.form}
            </th>
            <th scope="col" className={TH}>
              {INBOX_COPY.columns.preview}
            </th>
            <th scope="col" className={TH}>
              {INBOX_COPY.columns.received}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              data-message-row={r.id}
              data-unread={r.unread ? "" : undefined}
              className="h-14 border-b border-hub-border hover:bg-hub-surface-2"
            >
              <td className="px-4 py-2">
                <span className="flex min-w-0 items-center gap-2">
                  <FromButton
                    row={r}
                    onOpen={onOpen}
                    current={openId === r.id}
                  />
                  <TestBadge isTest={r.isTest} />
                  <UnreadBadge unread={r.unread} />
                </span>
              </td>
              <td className="truncate px-4 py-2 text-base text-hub-ink">
                {formLabel(r.formName, r.formDeleted)}
              </td>
              <td className="truncate px-4 py-2 text-base text-hub-ink-muted">
                {r.preview}
              </td>
              <td className="px-4 py-2 text-sm whitespace-nowrap text-hub-ink-muted tabular-nums">
                <time dateTime={r.created}>
                  {receivedLabel(r.created, timeZone, now)}
                </time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul aria-label="Messages" className="flex flex-col md:hidden">
        {rows.map((r) => (
          <li
            key={r.id}
            data-message-item={r.id}
            className="flex min-h-14 flex-col gap-1 border-b border-hub-border py-3"
          >
            <span className="flex min-w-0 items-center gap-2">
              <FromButton row={r} onOpen={onOpen} current={openId === r.id} />
              <TestBadge isTest={r.isTest} />
              <UnreadBadge unread={r.unread} />
            </span>
            <span className="truncate text-sm text-hub-ink-muted tabular-nums">
              {`${formLabel(r.formName, r.formDeleted)} · `}
              <time dateTime={r.created}>
                {receivedLabel(r.created, timeZone, now)}
              </time>
            </span>
            {r.preview ? (
              <span className="line-clamp-2 text-sm text-hub-ink-muted">
                {r.preview}
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      {hasMore ? (
        <div>
          <Button
            variant="secondary"
            loading={loadingMore}
            loadingLabel="Loading…"
            onClick={onLoadMore}
          >
            {INBOX_COPY.loadMore}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

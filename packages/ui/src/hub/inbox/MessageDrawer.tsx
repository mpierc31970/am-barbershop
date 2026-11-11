"use client";
// Message drawer (07-19; CONT-25, D231, D271, D311; 07-UI-SPEC "Inbox" message drawer,
// "Destructive actions" Delete message). Right Drawer, 480px (full width below 768px),
// URL-led by the app (&message=<id>).
//   - Title "Message from Maria Lopez"; Label meta "Contact form · On Home · 12 Sep, 2:14 pm".
//   - A <dl> of every answer (label 600, value Body keeping line breaks; empty answers left
//     out), "Newsletter: Agreed" when ticked (D271), and View contact when the app passes an
//     href (only for members who can read contacts; T-07-19-09).
//   - Footer, one primary: Reply by email (a mailto: built by mailtoHref, shown only when the
//     message has a valid email). A Filtered message shows Not spam (secondary) instead.
//   - Overflow: Mark as unread, and Delete message (content write only) confirmed in a
//     danger Dialog with Keep message focused.
//   - Read-only members (no content write) see no Not spam or Delete.
//   - 10-38: each uploaded file is a row of the same <dl>: the field label, then
//     "{name} · {size}" and a Download link to the org-scoped hub route (a plain <a download>,
//     never an inline preview).
// 14-35 (P14-P40): a launch-review test message shows a neutral "Test" badge in the header.
// It opens at once from the row; the body shows skeleton rows until the detail arrives. It
// does no fetching: the app passes the actions in. Every value is React text.
import { FILE_UPLOAD_COPY, formatFileSize } from "@cds/core/forms";
import { Download, MoreHorizontal, Reply, X } from "lucide-react";
import {
  useEffect,
  useId,
  useState,
  type AnchorHTMLAttributes,
  type ComponentType,
} from "react";
import type { HubActionResult } from "../addon-types";
import { Badge } from "../Badge";
import { Button, buttonClasses } from "../Button";
import { Dialog } from "../Dialog";
import { Drawer } from "../Drawer";
import { InlineAlert, Skeleton } from "../feedback";
import { IconButton } from "../IconButton";
import {
  DELETE_MESSAGE_COPY,
  INBOX_COPY,
  drawerMeta,
  drawerTitle,
  formFileHref,
  mailtoHref,
  type MessageDetailView,
} from "./copy";

type LinkLike = ComponentType<
  AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }
>;

export interface MessageDrawerProps {
  open?: boolean;
  /** The sender as the list shows it ("" when unknown, e.g. opened from a link alone). */
  from: string;
  detail: MessageDetailView | null;
  canWrite: boolean;
  timeZone: string;
  /** The site's name for the reply subject ("Re: your message to <site>"). */
  siteName: string;
  /** `/hub/marketing?tab=contacts&contact=<id>`, or null to hide View contact. */
  contactHref: string | null;
  onClose: () => void;
  onNotSpam: () => Promise<HubActionResult<null>>;
  onMarkUnread: () => Promise<HubActionResult<null>>;
  onDelete: () => Promise<HubActionResult<null>>;
  LinkComponent?: LinkLike;
}

const FAILED: HubActionResult<never> = {
  ok: false,
  code: "save_failed",
  message: "That didn't work. Check your connection and try again.",
};

const MENU_ITEM =
  "flex min-h-10 w-full items-center rounded px-3 text-left text-sm transition-colors " +
  "duration-150 hover:bg-hub-surface-2 pointer-coarse:min-h-11";

export function MessageDrawer({
  open = true,
  from,
  detail,
  canWrite,
  timeZone,
  siteName,
  contactHref,
  onClose,
  onNotSpam,
  onMarkUnread,
  onDelete,
  LinkComponent,
}: MessageDrawerProps) {
  const Link: LinkLike | "a" = LinkComponent ?? "a";
  const uid = useId();
  const sender = from.trim() !== "" ? from : (detail?.email ?? "");
  const title = drawerTitle(sender);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<"spam" | "unread" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // The delete confirm stays mounted (the native dialog returns focus to its opener), so its
  // safe choice is focused when it opens rather than through autoFocus on mount.
  useEffect(() => {
    if (!confirmDelete) return;
    document
      .querySelector<HTMLElement>(`[data-keep-message="${CSS.escape(uid)}"]`)
      ?.focus();
  }, [confirmDelete, uid]);

  function focusMore(): void {
    document
      .querySelector<HTMLElement>(`[data-message-more="${CSS.escape(uid)}"]`)
      ?.focus();
  }

  async function run(
    kind: "spam" | "unread",
    fn: () => Promise<HubActionResult<null>>,
  ): Promise<void> {
    if (busy) return;
    setBusy(kind);
    setError(null);
    const res = await fn().catch(() => FAILED);
    setBusy(null);
    if (!res.ok) setError(res.message);
  }

  async function doDelete(): Promise<void> {
    if (busy) return;
    setBusy("delete");
    setDeleteError(null);
    const res = await onDelete().catch(() => FAILED);
    setBusy(null);
    if (res.ok) setConfirmDelete(false);
    else setDeleteError(res.message);
  }

  const reply =
    detail && !detail.spam ? mailtoHref(detail.email, siteName) : null;
  const answers = detail
    ? detail.answers.filter(
        (a) => typeof a.value === "string" && a.value.trim() !== "",
      )
    : [];
  const files = detail?.files ?? [];
  const showMenu = detail !== null;
  const showNotSpam = detail !== null && detail.spam && canWrite;
  const showFooter = reply !== null || showNotSpam;

  return (
    <Drawer open={open} onClose={onClose} label={title} side="right">
      <div className="flex items-start justify-between gap-2 border-b border-hub-border px-6 py-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="min-w-0 truncate text-xl leading-tight font-semibold">
            {title}
          </h2>
          {detail?.isTest ? (
            <span data-message-test="">
              <Badge tone="role">
                <span aria-hidden="true">{INBOX_COPY.test}</span>
                <span className="sr-only">{INBOX_COPY.testSr}</span>
              </Badge>
            </span>
          ) : null}
          {detail ? (
            <p
              data-message-meta=""
              className="text-sm text-hub-ink-muted tabular-nums"
            >
              {drawerMeta(
                {
                  formName: detail.formName,
                  formDeleted: detail.formDeleted,
                  pageTitle: detail.page?.title ?? null,
                  created: detail.created,
                },
                timeZone,
              )}
            </p>
          ) : null}
        </div>
        <div className="relative flex shrink-0 items-center gap-1">
          {showMenu ? (
            <>
              <IconButton
                label={INBOX_COPY.more(sender)}
                tooltipAlign="end"
                data-message-more={uid}
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((o) => !o)}
                icon={<MoreHorizontal aria-hidden size={20} strokeWidth={2} />}
              />
              {menuOpen ? (
                <ul
                  aria-label={INBOX_COPY.more(sender)}
                  className="absolute top-full right-0 z-20 mt-1 flex min-w-56 flex-col gap-1 rounded border border-hub-border bg-hub-surface p-1 shadow-lg"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      // Close the menu only, not the drawer (the dialog's cancel).
                      e.preventDefault();
                      e.stopPropagation();
                      setMenuOpen(false);
                      focusMore();
                    }
                  }}
                >
                  <li>
                    <button
                      type="button"
                      autoFocus
                      className={`${MENU_ITEM} text-hub-ink`}
                      onClick={() => {
                        setMenuOpen(false);
                        focusMore();
                        void run("unread", onMarkUnread);
                      }}
                    >
                      {INBOX_COPY.markUnread}
                    </button>
                  </li>
                  {canWrite ? (
                    <li>
                      <button
                        type="button"
                        className={`${MENU_ITEM} text-hub-danger`}
                        onClick={() => {
                          // Focus goes back to More first, so the dialog returns it there.
                          focusMore();
                          setMenuOpen(false);
                          setConfirmDelete(true);
                        }}
                      >
                        {INBOX_COPY.deleteMessage}
                      </button>
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </>
          ) : null}
          <IconButton
            label={INBOX_COPY.close}
            tooltipAlign="end"
            onClick={onClose}
            icon={<X aria-hidden size={20} strokeWidth={2} />}
          />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-6 px-6 py-6">
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        {detail === null ? (
          <Skeleton rows={4} rowHeight={48} />
        ) : (
          <>
            <dl
              aria-label={INBOX_COPY.answers}
              data-answers=""
              className="flex flex-col gap-4"
            >
              {answers.map((a, i) => (
                <div key={`${i}-${a.label}`} className="flex flex-col gap-1">
                  <dt className="text-sm font-semibold text-hub-ink">
                    {a.label}
                  </dt>
                  <dd className="text-base break-words whitespace-pre-line text-hub-ink">
                    {a.value}
                  </dd>
                </div>
              ))}
              {files.map((f) => (
                <div
                  key={`file-${f.id}`}
                  data-file={f.id}
                  className="flex flex-col gap-1"
                >
                  <dt className="text-sm font-semibold text-hub-ink">
                    {f.label}
                  </dt>
                  <dd className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base text-hub-ink">
                    <span className="min-w-0 break-words">
                      {f.name} · {formatFileSize(f.size)}
                    </span>
                    <a
                      href={formFileHref(f.id)}
                      download
                      aria-label={`${FILE_UPLOAD_COPY.download} ${f.name}`}
                      className="inline-flex items-center gap-1 text-hub-accent underline underline-offset-2 pointer-coarse:min-h-11"
                    >
                      <Download aria-hidden size={16} strokeWidth={2} />
                      <span>{FILE_UPLOAD_COPY.download}</span>
                    </a>
                  </dd>
                </div>
              ))}
            </dl>
            {detail.newsletter ? (
              <p data-newsletter="" className="text-base text-hub-ink">
                {INBOX_COPY.newsletterAgreed}
              </p>
            ) : null}
            {contactHref ? (
              <p>
                <Link
                  href={contactHref}
                  className="text-base text-hub-accent underline underline-offset-2 pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
                >
                  {INBOX_COPY.viewContact}
                </Link>
              </p>
            ) : null}
          </>
        )}
      </div>

      {showFooter ? (
        <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-hub-border bg-hub-surface px-6 py-4">
          {showNotSpam ? (
            <Button
              variant="secondary"
              loading={busy === "spam"}
              onClick={() => void run("spam", onNotSpam)}
            >
              {INBOX_COPY.notSpam}
            </Button>
          ) : reply ? (
            <a
              href={reply}
              data-reply=""
              className={`${buttonClasses("primary")} pointer-coarse:h-11`}
            >
              <Reply aria-hidden size={16} strokeWidth={2} />
              <span>{INBOX_COPY.reply}</span>
            </a>
          ) : null}
        </div>
      ) : null}

      {showMenu && canWrite ? (
        <Dialog
          open={confirmDelete}
          onClose={() =>
            busy === "delete" ? undefined : setConfirmDelete(false)
          }
          title={DELETE_MESSAGE_COPY.title(sender)}
          footer={
            <>
              <Button
                variant="ghost"
                disabled={busy === "delete"}
                data-keep-message={uid}
                onClick={() => setConfirmDelete(false)}
              >
                {DELETE_MESSAGE_COPY.keep}
              </Button>
              <Button
                variant="destructive"
                loading={busy === "delete"}
                onClick={() => void doDelete()}
              >
                {DELETE_MESSAGE_COPY.confirm}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            {deleteError ? (
              <InlineAlert tone="error">{deleteError}</InlineAlert>
            ) : null}
            <p>{DELETE_MESSAGE_COPY.body}</p>
          </div>
        </Dialog>
      ) : null}
    </Drawer>
  );
}

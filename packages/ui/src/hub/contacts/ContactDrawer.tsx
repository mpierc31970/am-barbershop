"use client";
// Contact drawer (07-16; CONTACTS-01/02, D132, D266, D-UI-P7-21, D311; 07-UI-SPEC "Contacts"
// drawer, "Add contact", "Destructive actions" Delete contact, Remove note). Right Drawer,
// 480px (full width below 768px), URL-led by the app (&contact=<id> / &contact=new).
//   - Details: Name · Email (required) · Phone · Tags. Save contact (the one primary) stays
//     disabled until something changes; Discard changes resets. A save that hits another
//     contact's email shows DUP-CONTACT under Email with "Open <label>" and focuses Email.
//   - Newsletter: the read-only ConsentStatusLine; its only action is Mark as unsubscribed.
//     Nothing in this drawer subscribes anyone (D132).
//   - History: <ol> newest first, a 16px icon per kind, the summary (a form event links to its
//     message in the Inbox) and the date.
//   - Notes: the house list's notes (D-UI-P7-21). Add note (secondary); a note's author can
//     delete it, with an Undo toast that re-adds it.
//   - Overflow: Delete contact, confirmed in a danger Dialog with Keep contact focused.
//   - Read-only roles (staff, renter) get a <dl> and no footer, note form, delete or
//     unsubscribe control.
// The drawer opens at once from the row data; History and Notes show skeleton rows until the
// detail arrives. It does no fetching: the app passes the actions in.
import {
  Circle,
  Mail,
  MoreHorizontal,
  Upload,
  UserPlus,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type ComponentType,
  type ReactNode,
} from "react";
import type { HubActionResult } from "../addon-types";
import { Button } from "../Button";
import { Dialog } from "../Dialog";
import { Drawer } from "../Drawer";
import { InlineAlert, Skeleton } from "../feedback";
import { TextArea, TextField } from "../fields";
import { IconButton } from "../IconButton";
import { useToast } from "../Toast";
import { ConsentStatusLine } from "./ConsentStatusLine";
import { ContactTagInput } from "./ContactTagInput";
import {
  ADD_HELPER,
  CONTACTS_COPY,
  CONTACT_TOASTS,
  DELETE_CONTACT_COPY,
  NOTE_COPY,
  contactLabel,
  eventIcon,
  formatWhen,
  noteAuthor,
  type ContactEventView,
  type ContactNoteView,
  type ContactView,
  type EventIconName,
} from "./copy";

type LinkLike = ComponentType<
  AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }
>;

export type ContactFormValues = {
  name: string;
  email: string;
  phone: string;
  tags: string[];
};

export type ContactSaveResult =
  | { saved: ContactView }
  | { exists: { id: string; label: string; message: string } };

export type RestoredNote = { contact: string; list: string; body: string };

export interface ContactDrawerProps {
  open?: boolean;
  mode: "edit" | "new";
  contact: ContactView | null;
  detail: { events: ContactEventView[]; notes: ContactNoteView[] } | null;
  knownTags: readonly string[];
  canWrite: boolean;
  timeZone: string;
  formName?: string | null;
  onSave: (
    values: ContactFormValues & { id?: string },
  ) => Promise<HubActionResult<ContactSaveResult>>;
  onUnsubscribe: () => Promise<HubActionResult<null>>;
  onDelete: () => Promise<HubActionResult<null>>;
  onAddNote: (body: string) => Promise<HubActionResult<ContactNoteView>>;
  onDeleteNote: (id: string) => Promise<HubActionResult<RestoredNote>>;
  onRestoreNote: (
    restored: RestoredNote,
  ) => Promise<HubActionResult<ContactNoteView>>;
  onClose: () => void;
  hrefForContact: (id: string) => string;
  messageHref: (ref: string) => string;
  LinkComponent?: LinkLike;
}

const ICONS: Record<EventIconName, LucideIcon> = {
  Mail,
  Upload,
  UserPlus,
  Circle,
};

const FAILED: HubActionResult<never> = {
  ok: false,
  code: "save_failed",
  message:
    "Your changes weren't saved. Try again; if it keeps failing, copy your text somewhere safe first.",
};

function valuesOf(c: ContactView | null): ContactFormValues {
  return {
    name: c?.name ?? "",
    email: c?.email ?? "",
    phone: c?.phone ?? "",
    tags: c ? [...c.tags] : [],
  };
}

function same(a: ContactFormValues, b: ContactFormValues): boolean {
  return (
    a.name === b.name &&
    a.email === b.email &&
    a.phone === b.phone &&
    a.tags.length === b.tags.length &&
    a.tags.every((t, i) => t === b.tags[i])
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h3 id={id} className="text-base font-semibold text-hub-ink">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function ContactDrawer({
  open = true,
  mode,
  contact,
  detail,
  knownTags,
  canWrite,
  timeZone,
  formName = null,
  onSave,
  onUnsubscribe,
  onDelete,
  onAddNote,
  onDeleteNote,
  onRestoreNote,
  onClose,
  hrefForContact,
  messageHref,
  LinkComponent,
}: ContactDrawerProps) {
  const Link: LinkLike | "a" = LinkComponent ?? "a";
  const toast = useToast();
  const uid = useId();
  const emailId = `${uid}-email`;
  const isNew = mode === "new";
  const title =
    isNew || !contact ? CONTACTS_COPY.addTitle : contactLabel(contact);

  const [baseline, setBaseline] = useState<ContactFormValues>(() =>
    valuesOf(isNew ? null : contact),
  );
  const [values, setValues] = useState<ContactFormValues>(baseline);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dupe, setDupe] = useState<{
    id: string;
    label: string;
    message: string;
  } | null>(null);
  const [notes, setNotes] = useState<ContactNoteView[] | null>(
    detail ? detail.notes : null,
  );
  const [seenDetail, setSeenDetail] = useState(detail);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const focusEmail = useRef(false);

  // The detail arrives after the drawer opened from the row (or after a refresh).
  if (detail !== seenDetail) {
    setSeenDetail(detail);
    setNotes(detail ? detail.notes : null);
  }

  useEffect(() => {
    if (focusEmail.current) {
      focusEmail.current = false;
      document.getElementById(emailId)?.focus();
    }
  });

  // The delete confirm stays mounted (the native dialog returns focus to its opener), so
  // its safe choice is focused when it opens rather than through autoFocus on mount.
  useEffect(() => {
    if (!confirmDelete) return;
    document
      .querySelector<HTMLElement>(`[data-keep-contact="${CSS.escape(uid)}"]`)
      ?.focus();
  }, [confirmDelete, uid]);

  function focusMore(): void {
    document
      .querySelector<HTMLElement>(`[data-contact-more="${CSS.escape(uid)}"]`)
      ?.focus();
  }

  const dirty = !same(values, baseline);
  const set = <K extends keyof ContactFormValues>(
    k: K,
    v: ContactFormValues[K],
  ) => {
    setValues((prev) => ({ ...prev, [k]: v }));
    setSaveError(null);
    if (k === "email") setDupe(null);
  };

  async function save(): Promise<void> {
    if (!dirty || saving) return;
    setSaving(true);
    setSaveError(null);
    setDupe(null);
    const payload =
      !isNew && contact ? { ...values, id: contact.id } : { ...values };
    const res = await onSave(payload).catch(() => FAILED);
    setSaving(false);
    if (!res.ok) {
      setSaveError(res.message);
      return;
    }
    if ("exists" in res.data) {
      setDupe(res.data.exists);
      focusEmail.current = true;
      return;
    }
    const saved = valuesOf(res.data.saved);
    setBaseline(saved);
    setValues(saved);
  }

  async function addNote(): Promise<void> {
    const body = noteDraft.trim();
    if (body === "" || noteBusy) return;
    setNoteBusy(true);
    setNoteError(null);
    const res = await onAddNote(body).catch(() => FAILED);
    setNoteBusy(false);
    if (!res.ok) {
      setNoteError(res.message);
      return;
    }
    setNotes((list) => [res.data, ...(list ?? [])]);
    setNoteDraft("");
    toast.show({ message: CONTACT_TOASTS.noteAdded });
  }

  async function deleteNote(note: ContactNoteView): Promise<void> {
    const res = await onDeleteNote(note.id).catch(() => FAILED);
    if (!res.ok) {
      setNoteError(res.message);
      return;
    }
    setNotes((list) => (list ?? []).filter((n) => n.id !== note.id));
    const restored = res.data;
    toast.show({
      message: CONTACT_TOASTS.noteDeleted,
      action: {
        label: CONTACT_TOASTS.undo,
        onClick: () => {
          void onRestoreNote(restored)
            .catch(() => FAILED)
            .then((r) => {
              if (r.ok) setNotes((list) => [r.data, ...(list ?? [])]);
              else setNoteError(r.message);
            });
        },
      },
    });
  }

  async function doDelete(): Promise<void> {
    setDeleting(true);
    setDeleteError(null);
    const res = await onDelete().catch(() => FAILED);
    setDeleting(false);
    if (res.ok) setConfirmDelete(false);
    else setDeleteError(res.message);
  }

  const label = contact ? contactLabel(contact) : "";
  const showMenu = canWrite && !isNew && contact !== null;

  const details = canWrite ? (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <TextField
        id={`${uid}-name`}
        label="Name"
        value={values.name}
        maxLength={120}
        autoComplete="off"
        onChange={(e) => set("name", e.target.value)}
      />
      <TextField
        id={emailId}
        label="Email"
        type="email"
        required
        value={values.email}
        autoComplete="off"
        onChange={(e) => set("email", e.target.value)}
        error={
          dupe ? (
            <>
              {dupe.message}{" "}
              <Link
                href={hrefForContact(dupe.id)}
                className="font-semibold underline underline-offset-2"
              >
                {`Open ${dupe.label}`}
              </Link>
            </>
          ) : undefined
        }
      />
      <TextField
        id={`${uid}-phone`}
        label="Phone"
        type="tel"
        value={values.phone}
        maxLength={40}
        autoComplete="off"
        onChange={(e) => set("phone", e.target.value)}
      />
      <ContactTagInput
        id={`${uid}-tags`}
        tags={values.tags}
        knownTags={knownTags}
        onChange={(t) => set("tags", t)}
      />
      {isNew ? (
        <p className="text-sm text-hub-ink-muted">{ADD_HELPER}</p>
      ) : null}
      {saveError ? <InlineAlert tone="error">{saveError}</InlineAlert> : null}
      <button type="submit" hidden tabIndex={-1} aria-hidden />
    </form>
  ) : (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-base">
      <dt className="text-sm font-semibold text-hub-ink">Name</dt>
      <dd className={contact?.name ? "text-hub-ink" : "text-hub-ink-muted"}>
        {contact?.name || CONTACTS_COPY.noName}
      </dd>
      <dt className="text-sm font-semibold text-hub-ink">Email</dt>
      <dd className="break-all text-hub-ink">{contact?.email ?? ""}</dd>
      <dt className="text-sm font-semibold text-hub-ink">Phone</dt>
      <dd className="text-hub-ink tabular-nums">{contact?.phone ?? ""}</dd>
      <dt className="text-sm font-semibold text-hub-ink">Tags</dt>
      <dd className="text-hub-ink">{contact?.tags.join(", ") ?? ""}</dd>
    </dl>
  );

  return (
    <Drawer open={open} onClose={onClose} label={title} side="right">
      <div className="flex items-center justify-between gap-2 border-b border-hub-border px-6 py-4">
        <h2 className="min-w-0 truncate text-xl leading-tight font-semibold">
          {title}
        </h2>
        <div className="relative flex items-center gap-1">
          {showMenu ? (
            <>
              <IconButton
                label={CONTACTS_COPY.more(label)}
                tooltipAlign="end"
                data-contact-more={uid}
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((o) => !o)}
                icon={<MoreHorizontal aria-hidden size={20} strokeWidth={2} />}
              />
              {menuOpen ? (
                <ul
                  aria-label={`Actions for ${label}`}
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
                      className="flex min-h-10 w-full items-center rounded px-3 text-left text-sm text-hub-danger transition-colors duration-150 hover:bg-hub-surface-2 pointer-coarse:min-h-11"
                      onClick={() => {
                        // Focus goes back to More first, so the dialog returns it there.
                        focusMore();
                        setMenuOpen(false);
                        setConfirmDelete(true);
                      }}
                    >
                      {CONTACTS_COPY.deleteContact}
                    </button>
                  </li>
                </ul>
              ) : null}
            </>
          ) : null}
          <IconButton
            label={CONTACTS_COPY.close}
            tooltipAlign="end"
            onClick={onClose}
            icon={<X aria-hidden size={20} strokeWidth={2} />}
          />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-12 px-6 py-6">
        <Section title={CONTACTS_COPY.details}>{details}</Section>

        {!isNew && contact ? (
          <>
            <Section title={CONTACTS_COPY.newsletter}>
              <ConsentStatusLine
                consent={contact.consent}
                label={label}
                timeZone={timeZone}
                formName={formName}
                canWrite={canWrite}
                onUnsubscribe={onUnsubscribe}
              />
            </Section>

            <Section title={CONTACTS_COPY.history}>
              {detail === null ? (
                <Skeleton rows={3} rowHeight={40} />
              ) : detail.events.length === 0 ? (
                <p className="text-sm text-hub-ink-muted">
                  {CONTACTS_COPY.noHistory}
                </p>
              ) : (
                <ol className="flex flex-col gap-3" data-history="">
                  {detail.events.map((ev) => {
                    const name = eventIcon(ev.kind);
                    const Icon = ICONS[name];
                    const linked = ev.kind === "form" && ev.ref !== "";
                    return (
                      <li
                        key={ev.id}
                        data-event-icon={name}
                        className="flex items-start gap-3"
                      >
                        <Icon
                          aria-hidden
                          size={16}
                          strokeWidth={2}
                          className="mt-1 shrink-0 text-hub-ink-muted"
                        />
                        <div className="flex min-w-0 flex-col gap-1">
                          {linked ? (
                            <Link
                              href={messageHref(ev.ref)}
                              className="text-base text-hub-accent underline underline-offset-2"
                            >
                              {ev.summary}
                            </Link>
                          ) : (
                            <span className="text-base text-hub-ink">
                              {ev.summary}
                            </span>
                          )}
                          <span className="text-sm text-hub-ink-muted tabular-nums">
                            {formatWhen(ev.at, timeZone)}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </Section>

            <Section title={CONTACTS_COPY.notes}>
              {canWrite ? (
                <div className="flex flex-col gap-2">
                  <TextArea
                    id={`${uid}-note`}
                    label={NOTE_COPY.label}
                    rows={3}
                    maxLength={5000}
                    value={noteDraft}
                    onChange={(e) => {
                      setNoteDraft(e.target.value);
                      setNoteError(null);
                    }}
                    error={noteError ?? undefined}
                  />
                  <div>
                    <Button
                      variant="secondary"
                      loading={noteBusy}
                      disabled={noteDraft.trim() === "" || notes === null}
                      onClick={() => void addNote()}
                    >
                      {NOTE_COPY.button}
                    </Button>
                  </div>
                </div>
              ) : null}
              {notes === null ? (
                <Skeleton rows={2} rowHeight={40} />
              ) : notes.length === 0 ? (
                <p className="text-sm text-hub-ink-muted">
                  {CONTACTS_COPY.noNotes}
                </p>
              ) : (
                <ul className="flex flex-col gap-4" data-notes="">
                  {notes.map((n) => (
                    <li
                      key={n.id}
                      data-note={n.id}
                      className="flex flex-col gap-1 border-b border-hub-border pb-4"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-hub-ink-muted tabular-nums">
                          {`${noteAuthor(n)} · ${formatWhen(n.created, timeZone)}`}
                        </span>
                        {canWrite && n.mine ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void deleteNote(n)}
                          >
                            {NOTE_COPY.delete}
                          </Button>
                        ) : null}
                      </div>
                      <p className="text-base whitespace-pre-line text-hub-ink">
                        {n.body}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </>
        ) : null}
      </div>

      {canWrite ? (
        <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-hub-border bg-hub-surface px-6 py-4">
          <Button
            variant="ghost"
            disabled={!dirty || saving}
            onClick={() => {
              setValues(baseline);
              setDupe(null);
              setSaveError(null);
            }}
          >
            {CONTACTS_COPY.discard}
          </Button>
          <Button
            variant="primary"
            disabled={!dirty}
            loading={saving}
            loadingLabel="Saving…"
            onClick={() => void save()}
          >
            {CONTACTS_COPY.save}
          </Button>
        </div>
      ) : null}

      {showMenu ? (
        <Dialog
          open={confirmDelete}
          onClose={() => (deleting ? undefined : setConfirmDelete(false))}
          title={DELETE_CONTACT_COPY.title(label)}
          footer={
            <>
              <Button
                variant="ghost"
                disabled={deleting}
                data-keep-contact={uid}
                onClick={() => setConfirmDelete(false)}
              >
                {DELETE_CONTACT_COPY.keep}
              </Button>
              <Button
                variant="destructive"
                loading={deleting}
                onClick={() => void doDelete()}
              >
                {DELETE_CONTACT_COPY.confirm}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            {deleteError ? (
              <InlineAlert tone="error">{deleteError}</InlineAlert>
            ) : null}
            <p>{DELETE_CONTACT_COPY.body}</p>
          </div>
        </Dialog>
      ) : null}
    </Drawer>
  );
}

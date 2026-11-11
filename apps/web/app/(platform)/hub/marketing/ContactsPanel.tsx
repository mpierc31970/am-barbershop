"use client";
// Marketing › Contacts client panel (07-16; CONTACTS-01/02, D132, D236, D266, D120, D119,
// D-UI-P7-21/22, D311; 07-UI-SPEC "Contacts", "Contacts CSV import"). Wires the contacts
// actions into the @cds/ui contacts components. Owner-hub pattern (D311): list first, a drawer
// for the record, one primary per view (Add contact; while the list is empty, the empty
// state's Add contact is the one primary, P5 R2).
//   - Filters, sort and pages live in the URL. Filters replace it inside a transition: the
//     table dims and is aria-busy until the server answers.
//   - The drawer is URL-led on `contact` (&contact=<id> / &contact=new): local state opens it
//     at once from the row, then the URL loads the history and notes. Close removes the key.
//   - Read-only roles (staff, renter) see no Add, Import, template, Save, Delete, unsubscribe
//     or note controls; the chokepoint refuses their writes regardless (T-07-16-07).
//   - Import is the shared CsvImportDialog with the opt-in column matching and additive mode.
import {
  AddonTabHeader,
  Button,
  CONTACTS_COPY,
  CONTACT_MATCH_TARGETS,
  CONTACT_TOASTS,
  ContactDrawer,
  ContactFilters,
  ContactsTable,
  CsvImportDialog,
  EMPTY_CONTACTS,
  EMPTY_IMPORT_HELPER,
  EmptyState,
  FILTERED_EMPTY,
  GONE_COPY,
  IMPORT_CHOOSE_HINT,
  IMPORT_NOTE,
  InlineAlert,
  MATCH_EMAIL_COPY,
  TAG_ALL_LABEL,
  TAG_ALL_PLACEHOLDER,
  TAG_MAX_LEN,
  TrainingDrawer,
  countLine,
  importedToast,
  useToast,
  type ContactEventView,
  type ContactFilterPatch,
  type ContactListView,
  type ContactNoteView,
  type ContactView,
  type CsvFile,
  type HubActionResult,
  type ImportExtras,
} from "@cds/ui/hub";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  addContactNoteAction,
  commitContactImportAction,
  contactsTemplateAction,
  deleteContactAction,
  deleteContactNoteAction,
  exportContactsAction,
  previewContactImportAction,
  readContactImportHeaderAction,
  saveContactAction,
  withdrawConsentAction,
} from "../../../actions/contacts";
import { download } from "../_intake/list-helpers";
import { GuardedLink } from "../GuardedLink";
import { CONTACTS_STEPS, CONTACTS_TITLE } from "./contacts-steps";
import {
  contactsHref,
  hasFilters,
  type ContactsParams,
  type ContactsPatch,
} from "./contacts-params";

export interface ContactsPanelProps {
  rows: ContactView[];
  page: number;
  totalItems: number;
  totalPages: number;
  tags: string[];
  /** Passed only when the org has 2+ lists (D-UI-P7-21); otherwise []. */
  lists: ContactListView[];
  params: ContactsParams;
  open: {
    contact: ContactView;
    detail: { events: ContactEventView[]; notes: ContactNoteView[] };
  } | null;
  canWrite: boolean;
  timeZone: string;
  /** The contact in the URL is gone (deleted, or not on the reader's lists). */
  gone: boolean;
}

type Local = { id: string; row: ContactView | null } | null;

function initialLocal(p: ContactsPanelProps): Local {
  const c = p.params.contact;
  if (!c || p.gone) return null;
  if (c === "new") return { id: "new", row: null };
  return { id: c, row: p.open?.contact ?? null };
}

/** Inbox owns the message route (07-19); it opens the message drawer from `message` alone. */
function messageHref(ref: string): string {
  return `/hub/inbox?tab=messages&message=${encodeURIComponent(ref)}`;
}

export function ContactsPanel(props: ContactsPanelProps) {
  const {
    rows,
    page,
    totalItems,
    totalPages,
    tags,
    lists,
    params,
    open,
    canWrite,
    timeZone,
    gone,
  } = props;
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [local, setLocal] = useState<Local>(() => initialLocal(props));
  const [seenContact, setSeenContact] = useState(params.contact);
  const [importing, setImporting] = useState(false);
  const [training, setTraining] = useState(false);

  // The URL's contact changed under us (Back, a DUP-CONTACT "Open" link): follow it.
  if (params.contact !== seenContact) {
    setSeenContact(params.contact);
    if (!params.contact || gone) setLocal(null);
    else if (local?.id !== params.contact) {
      setLocal({
        id: params.contact,
        row:
          params.contact === "new"
            ? null
            : (rows.find((r) => r.id === params.contact) ??
              open?.contact ??
              null),
      });
    }
  }

  const listParam = params.list;
  const filtered = hasFilters(params);
  const empty = totalItems === 0 && !filtered;

  function go(patch: ContactsPatch): void {
    const href = contactsHref(params, patch);
    startTransition(() => router.replace(href, { scroll: false }));
  }

  function openContact(row: ContactView): void {
    setLocal({ id: row.id, row });
    go({ contact: row.id });
  }

  function openNew(): void {
    setLocal({ id: "new", row: null });
    go({ contact: "new" });
  }

  function closeDrawer(): void {
    setLocal(null);
    go({ contact: null });
  }

  function failed(res: { ok: false; message: string }): void {
    toast.show({ message: res.message });
  }

  async function exportCsv(): Promise<void> {
    const res = await exportContactsAction();
    if (res.ok) download(res.data as CsvFile);
    else failed(res);
  }

  async function template(): Promise<void> {
    const res = await contactsTemplateAction();
    if (res.ok) download(res.data as CsvFile);
    else failed(res);
  }

  // The open drawer's contact: the server's fresh read when it matches, else the row.
  const drawerContact =
    local && local.id !== "new"
      ? open && open.contact.id === local.id
        ? open.contact
        : local.row
      : null;
  const drawerDetail =
    local && open && open.contact.id === local.id ? open.detail : null;
  const drawerOpen =
    local !== null && (local.id === "new" ? canWrite : drawerContact !== null);

  return (
    <section
      aria-labelledby="contacts-heading"
      className="flex flex-col gap-6 font-hub text-hub-ink"
    >
      <AddonTabHeader
        heading={CONTACTS_COPY.heading}
        headingId="contacts-heading"
        countLine={countLine(totalItems)}
        helpLabel={CONTACTS_TITLE}
        onHelp={() => setTraining(true)}
        plural={CONTACTS_COPY.plural}
        primary={
          canWrite && !empty
            ? { label: CONTACTS_COPY.add, onClick: openNew }
            : null
        }
        onImport={canWrite ? () => setImporting(true) : undefined}
        menu={[
          ...(totalItems > 0 || filtered
            ? [
                {
                  label: CONTACTS_COPY.exportCsv,
                  onSelect: () => void exportCsv(),
                },
              ]
            : []),
          ...(canWrite
            ? [
                {
                  label: CONTACTS_COPY.template,
                  onSelect: () => void template(),
                },
              ]
            : []),
        ]}
      />

      {gone ? <InlineAlert tone="info">{GONE_COPY}</InlineAlert> : null}

      {empty ? (
        <EmptyState
          heading={EMPTY_CONTACTS.heading}
          body={canWrite ? EMPTY_CONTACTS.body : EMPTY_CONTACTS.readOnlyBody}
          action={
            canWrite ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="primary" onClick={openNew}>
                    {CONTACTS_COPY.add}
                  </Button>
                  <Button onClick={() => setImporting(true)}>
                    {CONTACTS_COPY.importFromSheet}
                  </Button>
                </div>
                <p className="text-sm text-hub-ink-muted">
                  {EMPTY_IMPORT_HELPER}
                </p>
              </div>
            ) : null
          }
        />
      ) : (
        <>
          <ContactFilters
            values={{
              q: params.q,
              source: params.source,
              tag: params.tag,
              consent: params.consent,
              list: params.list,
              sort: params.sort,
            }}
            tags={tags}
            lists={lists}
            onChange={(patch: ContactFilterPatch) =>
              go({ ...(patch as ContactsPatch), contact: null })
            }
          />
          {rows.length === 0 ? (
            <div
              aria-busy={pending || undefined}
              className="flex flex-col items-start gap-3 rounded border border-dashed border-hub-border px-6 py-12"
            >
              <p className="text-base text-hub-ink">{FILTERED_EMPTY}</p>
              <Button
                variant="ghost"
                onClick={() =>
                  go({
                    q: null,
                    source: null,
                    tag: null,
                    consent: null,
                    list: null,
                    contact: null,
                  })
                }
              >
                Clear filters
              </Button>
            </div>
          ) : (
            <ContactsTable
              rows={rows}
              sort={params.sort ?? "last_seen"}
              page={page}
              totalPages={totalPages}
              timeZone={timeZone}
              busy={pending}
              onOpen={openContact}
              hrefForSort={(sort) =>
                contactsHref(params, { sort, contact: null })
              }
              hrefForPage={(n) =>
                contactsHref(params, { page: n, contact: null })
              }
              LinkComponent={GuardedLink}
            />
          )}
        </>
      )}

      {drawerOpen && local ? (
        <ContactDrawer
          key={local.id}
          mode={local.id === "new" ? "new" : "edit"}
          contact={drawerContact}
          detail={drawerDetail}
          knownTags={tags}
          canWrite={canWrite}
          timeZone={timeZone}
          formName={null}
          LinkComponent={GuardedLink}
          hrefForContact={(id) => contactsHref(params, { contact: id })}
          messageHref={messageHref}
          onClose={closeDrawer}
          onSave={async (values) => {
            const res = await saveContactAction(values);
            if (res.ok && "saved" in res.data) {
              toast.show({ message: CONTACT_TOASTS.saved });
              const saved = res.data.saved;
              if (local.id === "new") {
                setLocal({ id: saved.id, row: saved });
                go({ contact: saved.id });
              } else {
                router.refresh();
              }
            }
            return res;
          }}
          onUnsubscribe={async () => {
            if (!drawerContact) return { ok: true, data: null };
            const res = await withdrawConsentAction(drawerContact.id);
            if (res.ok) {
              toast.show({ message: CONTACT_TOASTS.unsubscribed });
              router.refresh();
            }
            return res;
          }}
          onDelete={async () => {
            if (!drawerContact) return { ok: true, data: null };
            const res = await deleteContactAction(drawerContact.id);
            if (res.ok) {
              toast.show({ message: CONTACT_TOASTS.deleted });
              closeDrawer();
            }
            return res;
          }}
          onAddNote={(body) =>
            drawerContact
              ? addContactNoteAction(drawerContact.id, body, listParam)
              : Promise.resolve<HubActionResult<ContactNoteView>>({
                  ok: false,
                  code: "not_found",
                  message: GONE_COPY,
                })
          }
          onDeleteNote={(id) => deleteContactNoteAction(id)}
          onRestoreNote={(restored) =>
            addContactNoteAction(restored.contact, restored.body, restored.list)
          }
        />
      ) : null}

      {canWrite ? (
        <CsvImportDialog
          open={importing}
          onClose={() => setImporting(false)}
          title={CONTACTS_COPY.importTitle}
          singular={CONTACTS_COPY.singular}
          plural={CONTACTS_COPY.plural}
          chooseHint={IMPORT_CHOOSE_HINT}
          columnMatch={{
            readHeader: readContactImportHeaderAction,
            targets: CONTACT_MATCH_TARGETS,
            skipValue: "skip",
            requiredValue: "email",
            requiredCopy: MATCH_EMAIL_COPY,
          }}
          additive={{
            note: IMPORT_NOTE,
            tagAll: {
              label: TAG_ALL_LABEL,
              placeholder: TAG_ALL_PLACEHOLDER,
              maxLength: TAG_MAX_LEN,
            },
          }}
          onPreview={(text, _mode, extras?: ImportExtras) =>
            previewContactImportAction(text, extras ?? {})
          }
          onCommit={(text, _mode, _removals, extras?: ImportExtras) =>
            commitContactImportAction(text, extras ?? {})
          }
          onTemplate={() => void template()}
          onDone={(r) => {
            toast.show({ message: importedToast(r) });
            router.refresh();
          }}
        />
      ) : null}

      <TrainingDrawer
        open={training}
        onClose={() => setTraining(false)}
        title={CONTACTS_TITLE}
        steps={CONTACTS_STEPS}
      />
    </section>
  );
}

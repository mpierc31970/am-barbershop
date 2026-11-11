"use server";
// Contacts actions (07-16; CONTACTS-01/02, D132, D236, D266, D120, D-UI-P7-22; 07-UI-SPEC
// "Contacts", "Contacts CSV import"; T-07-16-01..05, T-07-16-08). Public POST endpoints:
// every argument is untrusted. The tenant, role and impersonation come only from the session
// cookie via runAction; no action takes an org id. Payload keys are allow-listed here and the
// @cds/db chokepoint validates them again (contacts write = Owner / Admin; staff and renters
// get the Forbidden copy). Record ids are shape-checked before they reach the chokepoint,
// which scopes every id to the session's tenant (a foreign id is the same NotFound as a
// missing one). Newsletter consent, the first source and the organization are never
// forwarded: nothing here can subscribe anyone (D132). Spreadsheet text is size-checked
// before any chokepoint call; the import is re-planned from the raw text on commit (07-11).
// Nothing here logs an email, a name, a phone number or a note body.
import { InvalidInput } from "@cds/core";
import { MAX_IMPORT_BYTES, type ImportPreview } from "@cds/core/csv";
import {
  CONTACT_IMPORT_TARGETS,
  ContactExists,
  addContactNote,
  commitContactImport,
  contactsCsvTemplate,
  deleteContact,
  deleteContactNote,
  exportContactsCsv,
  previewContactImport,
  readContactImportHeader,
  saveContact,
  withdrawConsent,
  type ContactColumnMapping,
  type ContactImportHeader,
  type ContactNote,
  type ContactRow,
} from "@cds/db";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "../../lib/action";

const ID = /^[a-z0-9]{1,32}$/i;
const GONE = "This was removed or moved. Reload the page to see the latest.";
const TAG_MAX_LEN = 40;
const TAGS_MAX = 20;
const MAPPING_MAX = 100;
const TAG_LONG_COPY = "Keep tags under 40 characters.";
const TAG_COUNT_COPY = "A contact can have up to 20 tags.";
const TAGS_SHAPE_COPY = "Tags must be a list of words.";
const FILE_COPY = "That file couldn't be read. Choose it again.";
const FILE_BIG_COPY =
  "That file is too big to import. Split it into smaller files.";
const MAPPING_COPY = "The column matches couldn't be read. Match them again.";
const NOTE_COPY = "Write a note first.";

const SAVE_KEYS = ["id", "name", "email", "phone", "tags"] as const;

function refreshHub(): void {
  try {
    revalidatePath("/hub/marketing");
  } catch (err) {
    console.error("[contacts] revalidate failed", err);
  }
}

function idOf(raw: unknown): string {
  if (typeof raw !== "string" || !ID.test(raw)) throw new InvalidInput(GONE);
  return raw;
}

function plain(raw: unknown): Record<string, unknown> {
  if (
    typeof raw !== "object" ||
    raw === null ||
    Array.isArray(raw) ||
    (Object.getPrototypeOf(raw) !== Object.prototype &&
      Object.getPrototypeOf(raw) !== null)
  ) {
    throw new InvalidInput("That contact couldn't be read. Try again.");
  }
  return raw as Record<string, unknown>;
}

/** Own, allow-listed keys only; anything else in the payload is dropped. */
function pick(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  const o = plain(raw);
  const out: Record<string, unknown> = {};
  for (const k of keys) if (Object.hasOwn(o, k)) out[k] = o[k];
  return out;
}

function textOf(raw: unknown): string {
  if (typeof raw !== "string") throw new InvalidInput(FILE_COPY);
  // UTF-16 length is a lower bound of the UTF-8 size; the engine checks the bytes again.
  if (raw.length > MAX_IMPORT_BYTES) throw new InvalidInput(FILE_BIG_COPY);
  return raw;
}

function tagsOf(raw: unknown): string[] {
  if (!Array.isArray(raw) || !raw.every((t) => typeof t === "string")) {
    throw new InvalidInput(TAGS_SHAPE_COPY);
  }
  if (raw.length > TAGS_MAX) throw new InvalidInput(TAG_COUNT_COPY);
  if (raw.some((t: string) => t.trim().length > TAG_MAX_LEN)) {
    throw new InvalidInput(TAG_LONG_COPY);
  }
  return raw as string[];
}

/** The save payload: id, name, email, phone, tags only (T-07-16-02). */
function saveInput(raw: unknown): Record<string, unknown> {
  const out = pick(raw, SAVE_KEYS);
  if (out.id === undefined || out.id === null || out.id === "") delete out.id;
  else out.id = idOf(out.id);
  if (Object.hasOwn(out, "tags")) out.tags = tagsOf(out.tags);
  return out;
}

type ImportExtras = { mapping?: ContactColumnMapping; tagAll?: string };

/** Column matches and "Tag everyone in this file", checked before the chokepoint. */
function importExtrasOf(raw: unknown): ImportExtras {
  if (raw === undefined || raw === null) return {};
  const o = plain(raw);
  const out: ImportExtras = {};
  if (o.mapping !== undefined && o.mapping !== null) {
    const m = o.mapping;
    if (
      !Array.isArray(m) ||
      m.length > MAPPING_MAX ||
      !m.every(
        (v) =>
          typeof v === "string" &&
          (CONTACT_IMPORT_TARGETS as readonly string[]).includes(v),
      )
    ) {
      throw new InvalidInput(MAPPING_COPY);
    }
    out.mapping = [...m] as ContactColumnMapping;
  }
  if (o.tagAll !== undefined && o.tagAll !== null) {
    if (typeof o.tagAll !== "string") throw new InvalidInput(TAG_LONG_COPY);
    const t = o.tagAll.trim();
    if (t.length > TAG_MAX_LEN) throw new InvalidInput(TAG_LONG_COPY);
    if (t !== "") out.tagAll = t;
  }
  return out;
}

export type SaveContactResult =
  | { saved: ContactRow }
  | { exists: { id: string; label: string; message: string } };

/**
 * Add (no id) or edit (id) a contact. Another contact with the same email is not an error
 * result: it comes back as `{exists}` so the drawer can show DUP-CONTACT with an Open link.
 */
export async function saveContactAction(
  input: unknown,
): Promise<ActionResult<SaveContactResult>> {
  const res: ActionResult<SaveContactResult> = await runAction(
    async (s): Promise<SaveContactResult> => {
      const payload = saveInput(input);
      try {
        return { saved: await saveContact(s.ctx, payload) };
      } catch (err) {
        if (err instanceof ContactExists) {
          return {
            exists: {
              id: err.contactId,
              label: err.label,
              message: err.message,
            },
          };
        }
        throw err;
      }
    },
  );
  if (res.ok && "saved" in res.data) refreshHub();
  return res;
}

/** "Mark as unsubscribed" (D132: the only consent change an owner can make). */
export async function withdrawConsentAction(
  id: unknown,
): Promise<ActionResult<null>> {
  const res = await runAction(async (s) => {
    await withdrawConsent(s.ctx, idOf(id));
    return null;
  });
  if (res.ok) refreshHub();
  return res;
}

export async function deleteContactAction(
  id: unknown,
): Promise<ActionResult<null>> {
  const res = await runAction(async (s) => {
    await deleteContact(s.ctx, idOf(id));
    return null;
  });
  if (res.ok) refreshHub();
  return res;
}

/** A note on one list (the house list when none is given, D-UI-P7-21). */
export async function addContactNoteAction(
  contactId: unknown,
  body: unknown,
  list?: unknown,
): Promise<ActionResult<ContactNote>> {
  const res = await runAction(async (s) => {
    const cid = idOf(contactId);
    if (typeof body !== "string") throw new InvalidInput(NOTE_COPY);
    const opts =
      typeof list === "string" && ID.test(list) ? { list } : undefined;
    return opts
      ? addContactNote(s.ctx, cid, body, opts)
      : addContactNote(s.ctx, cid, body);
  });
  if (res.ok) refreshHub();
  return res;
}

/** Author only (the chokepoint refuses anyone else). Returns what Undo needs. */
export async function deleteContactNoteAction(
  noteId: unknown,
): Promise<ActionResult<{ contact: string; list: string; body: string }>> {
  const res = await runAction(async (s) =>
    deleteContactNote(s.ctx, idOf(noteId)),
  );
  if (res.ok) refreshHub();
  return res;
}

export async function exportContactsAction(): Promise<
  ActionResult<{ filename: string; csv: string }>
> {
  return runAction(async (s) => ({
    filename: "contacts.csv",
    csv: await exportContactsCsv(s.ctx),
  }));
}

/** The template holds no tenant data, but still needs a signed-in member. */
export async function contactsTemplateAction(): Promise<
  ActionResult<{ filename: string; csv: string }>
> {
  return runAction(async () => ({
    filename: "contacts-template.csv",
    csv: contactsCsvTemplate(),
  }));
}

/** Import step 2: the header, an example per column, suggested matches. */
export async function readContactImportHeaderAction(
  text: unknown,
): Promise<ActionResult<ContactImportHeader>> {
  return runAction(async (s) => readContactImportHeader(s.ctx, textOf(text)));
}

/** Import step 3: counts (including merged by email) and row errors. Additive only. */
export async function previewContactImportAction(
  text: unknown,
  extras?: unknown,
): Promise<ActionResult<ImportPreview & { merged: number }>> {
  return runAction(async (s) => {
    const t = textOf(text);
    return previewContactImport(s.ctx, t, importExtrasOf(extras));
  });
}

/** Import step 4: re-plans from the raw text and writes. No removals, no backup. */
export async function commitContactImportAction(
  text: unknown,
  extras?: unknown,
): Promise<
  ActionResult<{
    added: number;
    updated: number;
    removed: number;
    backupId: string;
  }>
> {
  const res = await runAction(async (s) => {
    const t = textOf(text);
    const counts = await commitContactImport(s.ctx, t, importExtrasOf(extras));
    return {
      added: counts.added,
      updated: counts.updated,
      removed: 0,
      backupId: "",
    };
  });
  if (res.ok) refreshHub();
  return res;
}

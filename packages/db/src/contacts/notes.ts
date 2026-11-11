// Per-list private notes on a contact (CONTACTS-01/02, D266; T-07-11-03). A note belongs to one
// list: it is only ever read through that list, so a note added on one list never shows when
// the contact is read through another. No function returns notes across lists. Only the author
// may delete a note; the delete returns what the UI needs to re-add it (Undo).
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import type PocketBase from "pocketbase";
import { commit, scopedGet } from "../content/shared";
import type { OrgContext } from "../context";
import { newRecordId } from "../repository";
import { resolveListScope } from "./lists";
import { NOTE_MAX } from "./model";
import {
  isMember,
  projectNote,
  runContactsWrite,
  type ContactNote,
} from "./shared";

/** Internal: the notes of one contact on one list, newest first. */
export async function notesFor(
  pb: PocketBase,
  ctx: OrgContext,
  contactId: string,
  listId: string,
): Promise<ContactNote[]> {
  const rows = await pb.collection("contact_notes").getFullList({
    filter: pb.filter(
      "organization = {:org} && contact = {:c} && list = {:list}",
      { org: ctx.orgId, c: contactId, list: listId },
    ),
    sort: "-created,-id",
  });
  return rows.map((r) => projectNote(r, ctx));
}

function noteBody(raw: unknown): string {
  if (typeof raw !== "string") throw new InvalidInput("Write a note first.");
  const body = raw.replace(/\r\n?/g, "\n").trim();
  if (body === "") throw new InvalidInput("Write a note first.");
  if (body.length > NOTE_MAX) {
    throw new InvalidInput("Keep notes under 5,000 characters.");
  }
  return body;
}

/** Add a private note on one list (the house list by default). The contact must be on it. */
export function addContactNote(
  ctx: OrgContext,
  contactId: unknown,
  body: unknown,
  opts: { list?: string } = {},
): Promise<ContactNote> {
  return runContactsWrite(ctx, async (pb) => {
    const text = noteBody(body);
    const list = await resolveListScope(pb, ctx, opts.list);
    if (list === null) throw new NotFound();
    const contact = await scopedGet(pb, ctx, "contacts", contactId);
    if (!(await isMember(pb, ctx.orgId, list, contact.id))) {
      throw new NotFound();
    }
    const id = newRecordId();
    await commit(
      pb,
      ctx,
      [
        {
          collection: "contact_notes",
          op: "create",
          id,
          body: {
            organization: ctx.orgId,
            contact: contact.id,
            list,
            body: text,
            author: ctx.actor,
          },
        },
      ],
      {
        action: "contact_note.create",
        targetCollection: "contact_notes",
        targetId: id,
      },
    );
    return projectNote(await pb.collection("contact_notes").getOne(id), ctx);
  });
}

/** Delete a note (author only). Returns {contact, list, body} so the UI can Undo by re-adding. */
export function deleteContactNote(
  ctx: OrgContext,
  noteId: unknown,
): Promise<{ contact: string; list: string; body: string }> {
  return runContactsWrite(ctx, async (pb) => {
    const note = await scopedGet(pb, ctx, "contact_notes", noteId);
    if (note.author !== ctx.actor) {
      throw new Forbidden("Only the person who wrote a note can delete it.");
    }
    await commit(
      pb,
      ctx,
      [{ collection: "contact_notes", op: "delete", id: note.id }],
      {
        action: "contact_note.delete",
        targetCollection: "contact_notes",
        targetId: note.id,
      },
    );
    return {
      contact: String(note.contact),
      list: String(note.list),
      body: String(note.body),
    };
  });
}

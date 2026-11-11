"use client";
// CdsPostDialog (13-43 choice 1-3; STAFF-19 console side of `cds:post`; COMM-02, COMM-04;
// 13-UI-SPEC site detail "Support" line 786; T-13-43-04). One dialog, four kinds chosen
// explicitly with a SegmentedControl: Message · Internal message · Note (title, Pin) ·
// Document (file, title, note). The post is previewed as the business will see it (the P12
// CdsNoteCard for notes, the CDS message look for messages, the Documents row for files;
// an internal message shows INTERNAL-LINE and "Nobody is alerted"), and **Post to site**
// enables only once that preview is showing. Messages and notes go through the Server Action
// (postToSiteAction, routed like cds:post); a document posts multipart to
// `documentHref` (the 13-43 route: same origin, staff session, cds_post, 10 MB). A failure
// stays in the dialog with the inputs kept.
import { fillCopy, P13_COPY } from "@cds/core/staff";
import { FileText } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "../../hub/Button";
import { CdsMark, CdsSurface } from "../../hub/cds";
import { Dialog } from "../../hub/Dialog";
import { InlineAlert } from "../../hub/feedback";
import { TextArea, TextField } from "../../hub/fields";
import { SegmentedControl } from "../../hub/SegmentedControl";
import { CdsNoteCard } from "../../hub/support/documents";
import { MessageBody } from "../../hub/support/thread";
import { Switch } from "../../hub/Switch";
import { useToast } from "../../hub/Toast";
import { useStaffAction, type StaffActionResult } from "../dialogs";
import { SITE_ACTIONS_COPY } from "./actions-copy";

const C = SITE_ACTIONS_COPY.post;

export const CDS_POST_KINDS = [
  "message",
  "internal_message",
  "note",
  "document",
] as const;
export type CdsPostKind = (typeof CDS_POST_KINDS)[number];

/** The @cds/db limits (cds:post): message and note bodies, titles, document note, file. */
export const CDS_POST_LIMITS = Object.freeze({
  body: 5000,
  noteTitle: 80,
  docTitle: 120,
  docNote: 500,
  fileBytes: 10 * 1024 * 1024,
});

export interface PostToSiteInput {
  orgId: string;
  kind: Exclude<CdsPostKind, "document">;
  body: string;
  title?: string;
  pinned?: boolean;
}

export type PostToSiteAction = (
  input: PostToSiteInput,
) => Promise<StaffActionResult<{ message: string }>>;

export interface CdsPostDialogProps {
  open: boolean;
  onClose: () => void;
  orgId: string;
  business: string;
  /** Business time zone for the note preview date. */
  timeZone: string;
  post: PostToSiteAction;
  /** The document route, `/staff/api/sites/<org>/document`. */
  documentHref: string;
}

function bytesLabel(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** POST the document form; maps the route's JSON to a StaffActionResult. */
export async function postCdsDocument(
  href: string,
  form: FormData,
): Promise<StaffActionResult<{ message: string }>> {
  let res: Response;
  try {
    res = await fetch(href, {
      method: "POST",
      body: form,
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, code: "network", message: P13_COPY.ERR_SEND };
  }
  let data: { message?: unknown; error?: unknown; code?: unknown } = {};
  try {
    data = (await res.json()) as typeof data;
  } catch {
    // An empty or non-JSON body falls through to the generic copy.
  }
  if (res.ok && typeof data.message === "string") {
    return { ok: true, data: { message: data.message } };
  }
  if (res.status === 401) {
    return {
      ok: false,
      code: "session_ended",
      message: P13_COPY.SESSION_ENDED,
    };
  }
  return {
    ok: false,
    code: typeof data.code === "string" ? data.code : "error",
    message: typeof data.error === "string" ? data.error : P13_COPY.ERR_SEND,
  };
}

export function CdsPostDialog({
  open,
  onClose,
  orgId,
  business,
  timeZone,
  post,
  documentHref,
}: CdsPostDialogProps) {
  const base = useId();
  const toast = useToast();
  const [kind, setKind] = useState<CdsPostKind>("message");
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [pinned, setPinned] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runPost = useStaffAction(post, {
    describe: () => `${C.primary}: ${business}`,
  });
  const runDocument = useStaffAction(
    (form: FormData) => postCdsDocument(documentHref, form),
    { describe: () => `${C.primary}: ${business}` },
  );

  useEffect(() => {
    if (!open) return;
    setKind("message");
    setBody("");
    setTitle("");
    setPinned(false);
    setFile(null);
    setFileError(null);
    setError(null);
    setPending(false);
  }, [open]);

  const L = CDS_POST_LIMITS;
  const text = body.trim();
  const head = title.replace(/\s+/g, " ").trim();
  let ready = false;
  if (kind === "message" || kind === "internal_message") {
    ready = text !== "" && text.length <= L.body;
  } else if (kind === "note") {
    ready =
      text !== "" &&
      text.length <= L.body &&
      head !== "" &&
      head.length <= L.noteTitle;
  } else {
    ready =
      file !== null &&
      file.size <= L.fileBytes &&
      head !== "" &&
      head.length <= L.docTitle &&
      text.length <= L.docNote;
  }

  async function submit() {
    if (!ready || pending) return;
    setPending(true);
    setError(null);
    try {
      let res: StaffActionResult<{ message: string }>;
      if (kind === "document") {
        const form = new FormData();
        form.set("title", head);
        if (text) form.set("note", text);
        form.set("file", file as File);
        res = await runDocument(form);
      } else {
        res = await runPost({
          orgId,
          kind,
          body: text,
          ...(kind === "note" ? { title: head, pinned } : {}),
        });
      }
      if (res.ok) {
        toast.show({ message: res.data.message });
        onClose();
        return;
      }
      if (res.code !== "step_up_needed" && res.code !== "session_ended") {
        setError(res.message);
      }
    } finally {
      setPending(false);
    }
  }

  const previewHeading = fillCopy(C.preview, { business });
  const where =
    kind === "document"
      ? C.where.document
      : kind === "note"
        ? C.where.note
        : C.where.message;

  function preview() {
    if (!ready) {
      return (
        <p className="text-sm text-hub-ink-muted" data-post-preview-empty="">
          {C.previewEmpty}
        </p>
      );
    }
    if (kind === "internal_message") {
      return (
        <section
          aria-label={P13_COPY.INTERNAL_LINE}
          data-post-preview="internal_message"
          className="rounded border border-dashed border-hub-warning bg-(image:--hub-internal-hatch) p-4 forced-colors:bg-none"
        >
          <p className="text-sm font-semibold text-hub-ink">
            {P13_COPY.INTERNAL_LINE}
          </p>
          <MessageBody text={text} className="mt-2" />
          <p className="mt-3 text-sm text-hub-ink-muted">
            {C.internalRecipients}
          </p>
        </section>
      );
    }
    let inner;
    if (kind === "note") {
      const at = new Date().toISOString();
      inner = (
        <CdsNoteCard
          note={{
            id: "preview",
            title: head,
            body: text,
            pinned,
            authorName: "",
            created: at,
            updated: at,
          }}
          timeZone={timeZone}
        />
      );
    } else if (kind === "document") {
      inner = (
        <CdsSurface padding="md">
          <div className="flex items-start gap-3">
            <FileText aria-hidden size={20} className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold break-words text-hub-ink">{head}</p>
              <p className="text-sm text-hub-ink-muted">
                {file ? `${file.name} · ${bytesLabel(file.size)}` : ""}
              </p>
              {text ? <MessageBody text={text} className="mt-2" /> : null}
            </div>
          </div>
        </CdsSurface>
      );
    } else {
      inner = (
        <CdsSurface padding="md">
          <div className="flex items-center gap-2">
            <CdsMark size={20} />
            <span className="text-sm font-semibold text-hub-ink">CDS</span>
          </div>
          <MessageBody text={text} className="mt-2" />
        </CdsSurface>
      );
    }
    return (
      <section
        aria-label={previewHeading}
        data-post-preview={kind}
        className="flex flex-col gap-2"
      >
        <h3 className="text-sm font-semibold text-hub-ink-muted">
          {previewHeading} · {where}
        </h3>
        {inner}
        <p className="text-sm text-hub-ink-muted">{C.recipients}</p>
      </section>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!pending) onClose();
      }}
      title={fillCopy(C.title, { business })}
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={pending}
            className="max-sm:w-full"
          >
            {C.safe}
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={!ready || pending}
            loading={pending}
            loadingLabel={C.working}
            className="max-sm:w-full"
          >
            {C.primary}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 font-hub">
        <SegmentedControl
          name={`${base}-kind`}
          label={C.kind}
          value={kind}
          onChange={(k) => {
            setKind(k);
            setError(null);
            // WR-E07: the file input unmounts when leaving Document, so its file goes too.
            if (k !== "document") {
              setFile(null);
              setFileError(null);
            }
          }}
          options={CDS_POST_KINDS.map((k) => ({
            value: k,
            label: C.kinds[k],
          }))}
        />
        {kind === "note" || kind === "document" ? (
          <TextField
            id={`${base}-title`}
            label={kind === "note" ? C.noteTitle : C.docTitle}
            value={title}
            maxLength={kind === "note" ? L.noteTitle : L.docTitle}
            counter={{
              value: title.length,
              max: kind === "note" ? L.noteTitle : L.docTitle,
            }}
            onChange={(e) => setTitle(e.currentTarget.value)}
          />
        ) : null}
        {kind === "document" ? (
          <div className="flex flex-col gap-1">
            <label
              htmlFor={`${base}-file`}
              className="text-sm font-semibold text-hub-ink"
            >
              {C.file}
            </label>
            <input
              id={`${base}-file`}
              type="file"
              aria-describedby={`${base}-file-helper`}
              className="font-hub text-base text-hub-ink file:mr-3 file:rounded file:border file:border-hub-border-strong file:bg-hub-surface file:px-3 file:py-1.5"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0] ?? null;
                if (f && f.size > L.fileBytes) {
                  setFile(null);
                  setFileError(C.fileTooBig);
                  return;
                }
                setFileError(null);
                setFile(f);
              }}
            />
            <p
              id={`${base}-file-helper`}
              className="text-sm text-hub-ink-muted"
            >
              {C.fileHelper}
            </p>
            {fileError ? (
              <InlineAlert tone="error">{fileError}</InlineAlert>
            ) : null}
          </div>
        ) : null}
        <TextArea
          id={`${base}-body`}
          label={
            kind === "note"
              ? C.noteBody
              : kind === "document"
                ? C.docNote
                : C.body
          }
          value={body}
          rows={kind === "document" ? 3 : 6}
          maxLength={kind === "document" ? L.docNote : L.body}
          counter={{
            value: body.length,
            max: kind === "document" ? L.docNote : L.body,
          }}
          onChange={(e) => setBody(e.currentTarget.value)}
        />
        {kind === "note" ? (
          <Switch
            id={`${base}-pin`}
            label={C.pin}
            checked={pinned}
            onChange={setPinned}
          />
        ) : null}
        {preview()}
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      </div>
    </Dialog>
  );
}

"use client";
// Rich text editor (03-08; CONT-09; 03-UI-SPEC "Rich text"; donor RichTextEditor.tsx).
//
// A plain value/onChange surface so it drops into any form state. TipTap with the donor
// extension set plus OrderedList (rich-text-extensions.ts). Mounted client-side only
// (immediatelyRender false) so Next SSR never renders it and hydration never mismatches.
//
// Emits getHTML() on every update; an empty document (TipTap's "<p></p>") emits "".
// Nothing here sanitizes: the server sanitizes on save, publish and render (T-03-29), and
// the paste boundary (paste.ts) flattens anything that did not come from our own editor.
import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { isRichTextEmpty } from "@cds/core/content";
import { createRichTextExtensions } from "./rich-text-extensions";
import { preparePastedRichText } from "./paste";
import { RichTextToolbar } from "./RichTextToolbar";

export interface RichTextEditorProps {
  id: string;
  label: string;
  value: string;
  onChange: (html: string) => void;
  error?: string;
  helper?: string;
  placeholder?: string;
}

type PasteNotice = "paste" | "paste-table" | null;

// Tailwind's preflight strips list markers and paragraph margins; the editor restores
// just enough to read like the published text. The placeholder shows via Placeholder's
// data-placeholder attribute on the first empty paragraph.
const CONTENT_CLASS =
  "min-h-[160px] px-4 py-4 font-hub text-base leading-normal text-hub-ink focus:outline-none " +
  "[&_p+p]:mt-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 " +
  "[&_p.is-editor-empty:first-child]:before:pointer-events-none " +
  "[&_p.is-editor-empty:first-child]:before:float-left " +
  "[&_p.is-editor-empty:first-child]:before:h-0 " +
  "[&_p.is-editor-empty:first-child]:before:text-hub-ink-muted " +
  "[&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]";

export function RichTextEditor({
  id,
  label,
  value,
  onChange,
  error,
  helper,
  placeholder,
}: RichTextEditorProps) {
  // The HTML this component last emitted, so the sync effect can tell a parent-side
  // replacement from our own update round-tripping (re-setting would kill the caret).
  const lastEmitted = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const [notice, setNotice] = useState<PasteNotice>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  const describedBy =
    [helper ? `${id}-helper` : null, error ? `${id}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined;

  const editor = useEditor({
    immediatelyRender: false,
    content: value,
    extensions: createRichTextExtensions({ placeholder }),
    editorProps: {
      attributes: {
        id,
        class: CONTENT_CLASS,
        role: "textbox",
        "aria-multiline": "true",
        "aria-labelledby": `${id}-label`,
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
        ...(error ? { "aria-invalid": "true" } : {}),
      },
      transformPastedHTML: (html) => {
        const prepared = preparePastedRichText(html);
        if (prepared.flattened) {
          setNotice(prepared.hadTable ? "paste-table" : "paste");
          clearTimeout(noticeTimer.current);
          noticeTimer.current = setTimeout(() => setNotice(null), 8000);
        }
        return prepared.html;
      },
      // Ctrl/Cmd+U is Underline here, but browsers also bind it to View Source.
      handleKeyDown: (_view, event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          !event.altKey &&
          event.key.toLowerCase() === "u"
        ) {
          event.preventDefault();
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => {
      const html = e.getHTML();
      const out = isRichTextEmpty(html) ? "" : html;
      lastEmitted.current = out;
      onChangeRef.current(out);
    },
  });

  // Controlled sync: only when the parent replaced `value` from outside.
  useEffect(() => {
    if (!editor) return;
    if (value !== lastEmitted.current && value !== editor.getHTML()) {
      editor.commands.setContent(value, { emitUpdate: false });
      lastEmitted.current = value;
    }
  }, [value, editor]);

  // aria-invalid / describedby change with the error; the editor's attributes are set at
  // creation, so refresh them when those props change.
  useEffect(() => {
    if (!editor) return;
    editor.setOptions({
      editorProps: {
        ...editor.options.editorProps,
        attributes: {
          id,
          class: CONTENT_CLASS,
          role: "textbox",
          "aria-multiline": "true",
          "aria-labelledby": `${id}-label`,
          ...(describedBy ? { "aria-describedby": describedBy } : {}),
          ...(error ? { "aria-invalid": "true" } : {}),
        },
      },
    });
  }, [editor, id, describedBy, error]);

  return (
    <div className="flex flex-col gap-2 font-hub">
      <label
        id={`${id}-label`}
        // A <label for> cannot target a contenteditable; focus it by hand.
        onClick={() => editor?.chain().focus().run()}
        className="text-sm font-semibold text-hub-ink"
      >
        {label}
      </label>
      <div
        className={
          "rounded-lg border bg-hub-surface transition-colors duration-150 " +
          "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-hub-accent " +
          (error ? "border-hub-danger" : "border-hub-border-strong")
        }
      >
        <RichTextToolbar editor={editor} />
        {editor ? (
          <EditorContent editor={editor} />
        ) : (
          <div
            aria-hidden
            className="min-h-[160px] animate-pulse rounded-b-lg bg-hub-surface-2 motion-reduce:animate-none"
          />
        )}
      </div>
      {helper ? (
        <p id={`${id}-helper`} className="text-sm text-hub-ink-muted">
          {helper}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-hub-danger">
          {error}
        </p>
      ) : null}
      <div role="status" aria-live="polite" className="text-sm text-hub-ink">
        {notice === "paste" ? (
          <p className="rounded bg-hub-warning-tint px-3 py-2 text-hub-warning">
            Pasted as plain text. Select it and use the toolbar to add
            formatting.
          </p>
        ) : null}
        {notice === "paste-table" ? (
          <p className="rounded bg-hub-warning-tint px-3 py-2 text-hub-warning">
            Tables aren&apos;t supported here. Each cell came through as plain
            text on its own line.
          </p>
        ) : null}
      </div>
    </div>
  );
}

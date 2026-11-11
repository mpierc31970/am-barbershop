"use client";
// Rich text toolbar (03-08; CONT-09; 03-UI-SPEC "Rich text"; donor RichTextToolbar.tsx).
//
// Bold, Italic, Underline, Bulleted list, Numbered list as 32px IconButtons with
// aria-pressed. Active state comes from useEditorState on every transaction and selection
// change (the donor's fix for a toolbar that goes stale when only the caret moves).
// Roving tabindex: Tab reaches the toolbar once; ArrowLeft/Right wrap, Home/End jump.
// No link button: there is no link mark (03-01 decision).
import { useState, type KeyboardEvent } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { Bold, Italic, List, ListOrdered, Underline } from "lucide-react";
import { IconButton } from "../hub/IconButton";

export interface RichTextToolbarProps {
  editor: Editor | null;
}

type Command = "bold" | "italic" | "underline" | "bulletList" | "orderedList";

const BUTTONS: { key: Command; label: string; Icon: typeof Bold }[] = [
  { key: "bold", label: "Bold", Icon: Bold },
  { key: "italic", label: "Italic", Icon: Italic },
  { key: "underline", label: "Underline", Icon: Underline },
  { key: "bulletList", label: "Bulleted list", Icon: List },
  { key: "orderedList", label: "Numbered list", Icon: ListOrdered },
];

function run(editor: Editor, key: Command): void {
  const chain = editor.chain().focus();
  switch (key) {
    case "bold":
      chain.toggleBold().run();
      return;
    case "italic":
      chain.toggleItalic().run();
      return;
    case "underline":
      chain.toggleUnderline().run();
      return;
    case "bulletList":
      chain.toggleBulletList().run();
      return;
    case "orderedList":
      chain.toggleOrderedList().run();
      return;
  }
}

export function RichTextToolbar({ editor }: RichTextToolbarProps) {
  const [focused, setFocused] = useState(0);
  const active = useEditorState({
    editor,
    selector: (ctx) => ({
      bold: ctx.editor?.isActive("bold") ?? false,
      italic: ctx.editor?.isActive("italic") ?? false,
      underline: ctx.editor?.isActive("underline") ?? false,
      bulletList: ctx.editor?.isActive("bulletList") ?? false,
      orderedList: ctx.editor?.isActive("orderedList") ?? false,
    }),
  });

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const last = BUTTONS.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = focused === last ? 0 : focused + 1;
    if (event.key === "ArrowLeft") next = focused === 0 ? last : focused - 1;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = last;
    if (next === null) return;
    event.preventDefault();
    setFocused(next);
    event.currentTarget
      .querySelectorAll<HTMLButtonElement>("button[data-rt-button]")
      [next]?.focus();
  }

  return (
    <div
      role="toolbar"
      aria-label="Text formatting"
      onKeyDown={onKeyDown}
      className="flex items-center gap-1 rounded-t-lg border-b border-hub-border bg-hub-surface-2 px-2 py-1"
    >
      {BUTTONS.map(({ key, label, Icon }, i) => {
        const pressed = active?.[key] ?? false;
        return (
          <IconButton
            key={key}
            data-rt-button=""
            size="sm"
            label={label}
            icon={<Icon aria-hidden size={16} strokeWidth={2} />}
            aria-pressed={pressed}
            tabIndex={focused === i ? 0 : -1}
            disabled={!editor}
            onFocus={() => setFocused(i)}
            // Keep the text selection: a mousedown on the button would otherwise blur it.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor && run(editor, key)}
            className={
              pressed
                ? "bg-hub-accent-tint text-hub-ink ring-1 ring-hub-accent ring-inset"
                : undefined
            }
          />
        );
      })}
    </div>
  );
}

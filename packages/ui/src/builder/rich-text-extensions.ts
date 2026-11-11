// The TipTap extension list for RichTextEditor (03-08; CONT-09; CONTEXT A3-Q3; RESEARCH
// "TipTap extensions (verbatim donor + OrderedList)").
//
// Ported verbatim from donor DCR-Website src/components/admin/rich-text-extensions.ts, plus
// OrderedList. A plain module (no JSX, no "use client") so a test or harness can build the
// list without React. A factory, not a shared array, because Placeholder.configure takes a
// per-editor prop and two editors must never share configured extension objects.
//
// Deliberately absent: any link mark (03-01 decision; links live on button items, where
// safeHref validates them) and headings/blockquotes (headings are their own item kind).
// The stored HTML is sanitized again on the server on save, publish and render (T-03-29),
// so this list shapes what the owner can make, not what is trusted.
import { Document } from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { Bold } from "@tiptap/extension-bold";
import { Italic } from "@tiptap/extension-italic";
import { Underline } from "@tiptap/extension-underline";
import { HardBreak } from "@tiptap/extension-hard-break";
import {
  BulletList,
  ListItem,
  ListKeymap,
  OrderedList,
} from "@tiptap/extension-list";
import { Placeholder, UndoRedo } from "@tiptap/extensions";

// Enter inserts a line break, not a new paragraph, except inside a list, where Enter makes
// a new list item (donor D-03, Phase 6 D-12). Keymaps resolve in priority order, so 1000
// puts this ahead of Paragraph's split-on-Enter binding.
export const RichTextHardBreak = HardBreak.extend({
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        if (this.editor.isActive("listItem")) return false;
        return this.editor.commands.setHardBreak();
      },
      "Shift-Enter": () => this.editor.commands.setHardBreak(),
    };
  },
});

// Lists come only from the toolbar: a typed "- " or "1. " stays literal text, the same
// rule as the mark suppression below (donor RTE-05).
export const RichTextBulletList = BulletList.extend({
  addInputRules() {
    return [];
  },
});

export const RichTextOrderedList = OrderedList.extend({
  addInputRules() {
    return [];
  },
  addPasteRules() {
    return [];
  },
});

// Asterisks stay literal whether typed or pasted (donor D-45-05): the owner never deals
// in markup, so characters never silently vanish into formatting.
export const RichTextBold = Bold.extend({
  addInputRules() {
    return [];
  },
  addPasteRules() {
    return [];
  },
});

export const RichTextItalic = Italic.extend({
  addInputRules() {
    return [];
  },
  addPasteRules() {
    return [];
  },
});

/**
 * The extension list useEditor consumes. Order matters: keymap resolution depends on it,
 * and RichTextHardBreak must sit after Paragraph.
 */
export function createRichTextExtensions(options?: { placeholder?: string }) {
  return [
    Document,
    Paragraph,
    Text,
    RichTextBold,
    RichTextItalic,
    Underline,
    RichTextHardBreak,
    RichTextBulletList,
    RichTextOrderedList,
    ListItem,
    ListKeymap,
    Placeholder.configure({ placeholder: options?.placeholder ?? "" }),
    UndoRedo,
  ];
}

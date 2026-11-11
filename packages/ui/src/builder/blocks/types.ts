// The editor contract for P7 core blocks (07-05; 07-UI-SPEC "Block picker").
//
// SectionForm's default branch looks a type up in BUILDER_BLOCKS_A / BUILDER_BLOCKS_B
// (own-property only) before the add-on fallthrough, and the block picker lists every
// entry under its picker group. 07-06 and 07-07 register editors by editing only their
// own group file. popups / timeZone / onDirtyChange let slides and tabs (07-20) reuse
// ColumnsEditor.
import type { ComponentType, MutableRefObject } from "react";
import type { PopupOption } from "../ColumnItemForm";

/**
 * 07-20: lets SectionForm reach an editor with nested draft state (slides, tab panels)
 * on Save block and Discard changes: flush its open item form, read its newest content
 * fields (merged over the draft), or drop its open edits. Editors without nested state
 * ignore it.
 */
export interface CoreBlockEditorHandle {
  /** Save any open item form into the block draft; false if it did not validate. */
  flush: () => Promise<boolean>;
  /** Close open item forms and drop their edits. */
  discard: () => void;
  /** The newest content fields this editor owns (e.g. `{ slides }`), or null. */
  latest: () => Record<string, unknown> | null;
}

export interface CoreBlockEditorProps {
  type: string;
  content: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
  errors: Readonly<Record<string, string>>;
  popups: readonly PopupOption[];
  timeZone?: string;
  onDirtyChange?: (dirty: boolean) => void;
  /** 07-20: optional handle for editors with nested draft state (see above). */
  handleRef?: MutableRefObject<CoreBlockEditorHandle | null>;
}

/** Picker group below "Blocks" (UI-SPEC order: Blocks, Photos and video, Information). */
export type BuilderPickerGroup = "photos-video" | "information";

export interface BuilderBlockEntry {
  Editor: ComponentType<CoreBlockEditorProps>;
  picker: BuilderPickerGroup;
  /** Tile order inside its picker group, ascending. */
  order: number;
}

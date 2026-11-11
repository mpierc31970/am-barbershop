"use client";
// CannedPicker (13-41 choice 2; STAFF-09, D96, D119; 13-UI-SPEC "CannedPicker" lines 503-511).
// Opened from the composer (`/` or Canned reply). A Dialog with an autofocused Search replies
// field and a listbox of titles + first lines: arrows move, Enter (or a click) inserts, Esc
// closes. Insert runs @cds/core/staff renderCanned(body, vars) so {first_name}, {business},
// {ticket} and {agent} arrive filled; an unknown token (InvalidInput) shows
// PLACEHOLDER-UNKNOWN and inserts nothing. PlaceholderPreview shows the active reply filled
// before it goes in. Footer: Manage canned replies. Empty: "No canned replies yet." + Add one.
import { renderCanned, type CannedVars } from "@cds/core/staff";
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { Button } from "../../hub/Button";
import { Dialog } from "../../hub/Dialog";
import { TextField } from "../../hub/fields";
import {
  PlaceholderPreview,
  PlaceholderUnknown,
  tryRenderCanned,
} from "./PlaceholderPreview";

export type CannedOption = { id: string; title: string; body: string };

export const CANNED_PICKER_COPY = {
  title: "Canned reply",
  search: "Search replies",
  listLabel: "Canned replies",
  empty: "No canned replies yet.",
  addOne: "Add one",
  noMatch: "No replies match.",
  manage: "Manage canned replies",
  insert: "Insert reply",
  close: "Close",
  preview: "Inserts as",
} as const;

export const CANNED_MANAGE_HREF = "/staff/tickets?tab=canned";

const C = CANNED_PICKER_COPY;

function firstLine(body: string): string {
  return body.split("\n").find((l) => l.trim() !== "") ?? "";
}

export interface CannedPickerProps {
  open: boolean;
  onClose(): void;
  canned: readonly CannedOption[];
  vars: CannedVars;
  timeZone: string;
  /** The filled text to place at the caret (the composer keeps it editable). */
  onInsert(text: string, reply: CannedOption): void;
  manageHref?: string;
}

export function CannedPicker({
  open,
  onClose,
  canned,
  vars,
  timeZone,
  onInsert,
  manageHref = CANNED_MANAGE_HREF,
}: CannedPickerProps) {
  const id = useId();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [unknown, setUnknown] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      setUnknown(null);
    }
  }, [open]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return canned;
    return canned.filter(
      (c) =>
        c.title.toLowerCase().includes(term) ||
        c.body.toLowerCase().includes(term),
    );
  }, [canned, q]);

  const current = shown[Math.min(active, shown.length - 1)] ?? null;

  function insert(reply: CannedOption | null) {
    if (!reply) return;
    let text: string;
    try {
      text = renderCanned(reply.body, vars);
    } catch {
      const r = tryRenderCanned(reply.body, vars);
      setUnknown(r.ok ? "" : r.token);
      return;
    }
    setUnknown(null);
    onInsert(text, reply);
  }

  function onKey(e: KeyboardEvent<HTMLElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(shown.length - 1, 0)));
      setUnknown(null);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
      setUnknown(null);
    } else if (e.key === "Enter") {
      e.preventDefault();
      insert(current);
    }
  }

  const optionId = (i: number) => `${id}-opt-${i}`;
  const link =
    "rounded text-sm font-semibold text-hub-accent underline-offset-2 hover:underline " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={C.title}
      footer={
        <>
          <a href={manageHref} className={`${link} mr-auto self-center`}>
            {C.manage}
          </a>
          <Button variant="ghost" onClick={onClose}>
            {C.close}
          </Button>
          <Button
            variant="primary"
            disabled={!current}
            onClick={() => insert(current)}
          >
            {C.insert}
          </Button>
        </>
      }
    >
      <div data-canned-picker="" className="flex flex-col gap-4">
        {canned.length === 0 ? (
          <p className="text-base text-hub-ink-muted">
            {C.empty}{" "}
            <a href={`${manageHref}&new=1`} className={link}>
              {C.addOne}
            </a>
          </p>
        ) : (
          <>
            <TextField
              id={`${id}-search`}
              label={C.search}
              value={q}
              autoFocus
              autoComplete="off"
              role="combobox"
              aria-expanded
              aria-controls={`${id}-list`}
              aria-activedescendant={
                current ? optionId(shown.indexOf(current)) : undefined
              }
              onChange={(e) => {
                setQ(e.currentTarget.value);
                setActive(0);
                setUnknown(null);
              }}
              onKeyDown={onKey}
            />
            {shown.length === 0 ? (
              <p className="text-base text-hub-ink-muted">{C.noMatch}</p>
            ) : (
              <ul
                id={`${id}-list`}
                role="listbox"
                aria-label={C.listLabel}
                className="flex max-h-56 flex-col overflow-y-auto rounded border border-hub-border"
              >
                {shown.map((c, i) => {
                  const on = c === current;
                  return (
                    <li
                      key={c.id}
                      id={optionId(i)}
                      role="option"
                      aria-selected={on}
                      data-canned-option={c.id}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => insert(c)}
                      className={
                        "flex cursor-pointer flex-col gap-0.5 border-b border-hub-border px-3 py-2 last:border-b-0 " +
                        (on ? "bg-hub-surface-2" : "bg-hub-surface")
                      }
                    >
                      <span className="text-base font-semibold text-hub-ink">
                        {c.title}
                      </span>
                      <span className="truncate text-sm text-hub-ink-muted">
                        {firstLine(c.body)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {unknown !== null && unknown !== "" ? (
              <PlaceholderUnknown token={unknown} />
            ) : current ? (
              <PlaceholderPreview
                body={current.body}
                vars={vars}
                timeZone={timeZone}
                label={C.preview}
              />
            ) : null}
          </>
        )}
      </div>
    </Dialog>
  );
}

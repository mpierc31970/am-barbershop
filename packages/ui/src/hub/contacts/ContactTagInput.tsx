"use client";
// Contact tag chip input (07-16; CONTACTS-01, D119; 07-UI-SPEC "Contacts" drawer Details).
// Enter or "," adds the typed tag (trimmed, case-insensitive dedupe, at most 40 characters and
// 20 tags, inline error copy otherwise). Each chip has an X button named "Remove tag <tag>";
// Backspace on an empty input removes the last tag. A <datalist> offers the tags already in
// use, so the owner reuses "VIP" rather than typing "vip " again. Tags render as React text.
import { X } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { TAG_MAX_LEN, TAGS_MAX } from "./copy";

export interface ContactTagInputProps {
  id: string;
  label?: string;
  tags: readonly string[];
  onChange: (tags: string[]) => void;
  knownTags?: readonly string[];
  disabled?: boolean;
}

export const TAG_TOO_LONG_COPY = `Keep each tag under ${TAG_MAX_LEN} characters.`;
export const TAG_TOO_MANY_COPY = `A contact can have up to ${TAGS_MAX} tags. Remove one first.`;
export const TAG_HELPER = "Press Enter or a comma to add a tag.";

export function ContactTagInput({
  id,
  label = "Tags",
  tags,
  onChange,
  knownTags = [],
  disabled = false,
}: ContactTagInputProps) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const listId = `${id}-known`;
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;

  function add(raw: string): void {
    const t = raw.replace(/\s+/g, " ").trim();
    if (t === "") return;
    if (t.length > TAG_MAX_LEN) {
      setError(TAG_TOO_LONG_COPY);
      return;
    }
    if (tags.some((x) => x.toLowerCase() === t.toLowerCase())) {
      setDraft("");
      setError(null);
      return;
    }
    if (tags.length >= TAGS_MAX) {
      setError(TAG_TOO_MANY_COPY);
      return;
    }
    setError(null);
    setDraft("");
    onChange([...tags, t]);
  }

  function remove(tag: string): void {
    setError(null);
    onChange(tags.filter((t) => t !== tag));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
      e.preventDefault();
      remove(tags[tags.length - 1]!);
    }
  }

  const describedBy = [helperId, error ? errorId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="flex flex-col gap-2 font-hub">
      <label htmlFor={id} className="text-sm font-semibold text-hub-ink">
        {label}
      </label>
      {tags.length > 0 ? (
        <ul aria-label={label} className="flex flex-wrap gap-2">
          {tags.map((t) => (
            <li
              key={t}
              className="inline-flex items-center gap-1 rounded bg-hub-surface-2 py-1 pr-1 pl-2 text-sm text-hub-ink"
            >
              <span>{t}</span>
              {disabled ? null : (
                <button
                  type="button"
                  aria-label={`Remove tag ${t}`}
                  onClick={() => remove(t)}
                  className={
                    "inline-flex h-6 w-6 items-center justify-center rounded text-hub-ink-muted " +
                    "transition-colors duration-150 hover:bg-hub-border hover:text-hub-ink " +
                    "pointer-coarse:h-11 pointer-coarse:w-11"
                  }
                >
                  <X aria-hidden size={16} strokeWidth={2} />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {disabled ? null : (
        <input
          id={id}
          type="text"
          list={listId}
          value={draft}
          autoComplete="off"
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            const v = e.target.value;
            if (v.includes(",")) {
              const parts = v.split(",");
              add(parts[0] ?? "");
              setDraft(parts.slice(1).join(","));
            } else {
              setDraft(v);
              if (error) setError(null);
            }
          }}
          onKeyDown={onKeyDown}
          onBlur={() => add(draft)}
          className={
            "h-10 w-full rounded border bg-hub-surface px-3 text-base text-hub-ink " +
            "transition-colors duration-150 placeholder:text-hub-ink-muted " +
            (error
              ? "border-hub-danger"
              : "border-hub-border-strong hover:border-hub-ink-muted")
          }
        />
      )}
      <datalist id={listId}>
        {knownTags
          .filter((k) => !tags.some((t) => t.toLowerCase() === k.toLowerCase()))
          .map((k) => (
            <option key={k} value={k} />
          ))}
      </datalist>
      {disabled ? null : (
        <p id={helperId} className="text-sm text-hub-ink-muted">
          {TAG_HELPER}
        </p>
      )}
      {error ? (
        <p id={errorId} className="text-sm text-hub-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

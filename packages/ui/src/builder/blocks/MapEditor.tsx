"use client";
// MapEditor (07-24; CONT-24, D230, D253, D119; 07-UI-SPEC row "Map"; D311 admin pattern;
// replaces the 07-07 stub body, name and BUILDER_BLOCKS_B entry kept).
//
// Heading (default "Find us") · Address: an address or a pasted Google Maps link, parsed
// client-side with core parseMapLink on blur or paste ("Found: Rivera Bakery" for a link;
// the thrown copy inline for an unreadable or short link, content unchanged). The field is
// empty by default with the business address as its placeholder (choice 3: the address is
// live, never copied into content; location "" = use the business address) · Show
// "Get directions" · an info InlineAlert when no address exists anywhere. Server-side
// errors.location shows through the field's error wiring. Background stays in SectionForm.
import { parseMapLink } from "@cds/core/content";
import { useEffect, useId, useState, type ClipboardEvent } from "react";
import { TextField } from "../../hub/fields";
import { InlineAlert } from "../../hub/feedback";
import { Switch } from "../../hub/Switch";
import {
  BUSINESS_INFO_HREF,
  SETTINGS_LINK_CLASS,
  useBuilderBusiness,
} from "./business-context";
import type { CoreBlockEditorProps } from "./types";

const HINT = "Paste an address or a Google Maps link.";
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function MapEditor({ content, onChange, errors }: CoreBlockEditorProps) {
  const uid = useId();
  const business = useBuilderBusiness();
  const addressText = business?.addressText ?? "";
  const heading =
    typeof content.heading === "string" ? content.heading : "Find us";
  const location = typeof content.location === "string" ? content.location : "";
  const showDirections = content.show_directions !== false;
  const [draft, setDraft] = useState(location);
  const [found, setFound] = useState("");
  const [error, setError] = useState("");

  // A restore or discard replaces the content: follow it.
  useEffect(() => {
    setDraft((d) => (d.trim() === location ? d : location));
  }, [location]);

  /** Parse the input; a link reports what it found. Returns false on a refused link. */
  function commit(input: string, announce: boolean): boolean {
    const trimmed = input.trim();
    if (trimmed === "") {
      setError("");
      setFound("");
      if (location !== "") onChange("location", "");
      return true;
    }
    try {
      const q = parseMapLink(trimmed);
      const query = q?.query ?? "";
      setError("");
      if (query !== location) onChange("location", query);
      if (announce && SCHEME.test(trimmed)) {
        setFound(query);
        setDraft(query);
      }
      return true;
    } catch (e) {
      setFound("");
      setError(e instanceof Error ? e.message : HINT);
      return false;
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData?.getData("text") ?? "";
    if (!SCHEME.test(text.trim())) return;
    e.preventDefault();
    setDraft(text);
    commit(text, true);
  }

  const helper = found
    ? `Found: ${found}`
    : addressText
      ? `${HINT} Leave blank to use your business address: ${addressText}`
      : HINT;
  const noAddress =
    addressText === "" && location === "" && draft.trim() === "";

  return (
    <div className="flex flex-col gap-6 font-hub">
      <TextField
        id={`${uid}-heading`}
        label="Heading"
        value={heading}
        error={errors.heading}
        onChange={(e) => onChange("heading", e.currentTarget.value)}
      />
      <TextField
        id={`${uid}-address`}
        label="Address"
        value={draft}
        placeholder={addressText}
        helper={helper}
        error={error || errors.location}
        autoComplete="off"
        onChange={(e) => {
          const v = e.currentTarget.value;
          setDraft(v);
          setFound("");
          // Plain addresses apply as typed; links wait for blur or paste.
          if (!SCHEME.test(v.trim())) commit(v, false);
        }}
        onBlur={(e) => commit(e.currentTarget.value, true)}
        onPaste={onPaste}
      />
      <Switch
        id={`${uid}-directions`}
        label={'Show "Get directions"'}
        checked={showDirections}
        onChange={(v) => onChange("show_directions", v)}
      />
      {noAddress ? (
        <InlineAlert tone="info">
          <p>
            Add your address in Settings › Business info, or type one here.{" "}
            <a href={BUSINESS_INFO_HREF} className={SETTINGS_LINK_CLASS}>
              Edit business info
            </a>
          </p>
        </InlineAlert>
      ) : null}
    </div>
  );
}

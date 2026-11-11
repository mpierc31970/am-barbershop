"use client";
// PlaceholderPreview (13-41 choice 2; STAFF-09, D96; 13-UI-SPEC "Canned replies" lines 503-528).
// A canned reply as the owner would see it: the body run through @cds/core/staff renderCanned
// (placeholders filled) and shown in the P12 CDS reply look (ThreadMessage, "Mara · CDS").
// An unknown {token} shows PLACEHOLDER-UNKNOWN with the token highlighted instead. Used by the
// canned picker (the ticket's real values) and the Canned replies form (sample values).
import {
  cannedPlaceholders,
  isCannedToken,
  P13_COPY,
  renderCanned,
  type CannedVars,
} from "@cds/core/staff";
import { ThreadMessage } from "../../hub/support/thread/ThreadMessage";

export type CannedRender =
  { ok: true; text: string } | { ok: false; token: string };

/** renderCanned without throwing: the filled text, or the first unknown `{token}`. */
export function tryRenderCanned(body: string, vars: CannedVars): CannedRender {
  const unknown = cannedPlaceholders(body).find((t) => !isCannedToken(t));
  if (unknown !== undefined) return { ok: false, token: `{${unknown}}` };
  try {
    return { ok: true, text: renderCanned(body, vars) };
  } catch {
    // renderCanned only throws InvalidInput for an unknown token (checked above).
    return { ok: false, token: "" };
  }
}

/** PLACEHOLDER-UNKNOWN with the offending token in a <mark>. */
export function PlaceholderUnknown({
  token,
  id,
}: {
  token: string;
  id?: string;
}) {
  const [before, after] = P13_COPY.PLACEHOLDER_UNKNOWN.split("{token}");
  return (
    <p
      id={id}
      role="alert"
      data-placeholder-unknown=""
      className="font-hub text-sm font-semibold text-hub-danger"
    >
      {before}
      <mark className="rounded-sm bg-hub-danger-tint px-0.5 text-hub-danger forced-colors:bg-[Mark]">
        {token}
      </mark>
      {after}
    </p>
  );
}

export interface PlaceholderPreviewProps {
  body: string;
  vars: CannedVars;
  timeZone: string;
  /** Visible heading above the preview. */
  label?: string;
}

const NO_DOWNLOAD = () => undefined;

export function PlaceholderPreview({
  body,
  vars,
  timeZone,
  label,
}: PlaceholderPreviewProps) {
  const r = tryRenderCanned(body, vars);
  return (
    <section data-placeholder-preview="" className="flex flex-col gap-2">
      {label ? (
        <p className="font-hub text-sm font-semibold text-hub-ink">{label}</p>
      ) : null}
      {r.ok ? (
        <ThreadMessage
          message={{
            id: "preview",
            authorKind: "staff",
            authorName: vars.agent,
            body: r.text,
            attachments: [],
            created: new Date().toISOString(),
          }}
          timeZone={timeZone}
          onDownload={NO_DOWNLOAD}
        />
      ) : (
        <PlaceholderUnknown token={r.token} />
      )}
    </section>
  );
}

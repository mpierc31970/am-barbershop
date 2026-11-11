"use client";
// Documents tab (12-25 choice 2; COMM-04, D187, D-UI-P12-14; 12-UI-SPEC Documents lines
// 503-521). The client island under the server loader in page.tsx:
//   - DocumentList: Shared by CDS (with "New" on unread documents) and From your tickets and
//     messages, with the All · From CDS · From you filter (`?from=` link-state; the loader
//     reads every file, so the filter is instant and the URL is replaced).
//   - Download mints a 15-minute link on click (mintSupportFileLinkAction); no link ever sits
//     in the markup (T-12-25-01). A refused mint (still checking, removed) shows its message.
//   - Opening the tab marks CDS documents read for this person (markDocumentsReadAction;
//     skipped while impersonating and when nothing is unread).
//   - DocumentList shows 50 rows then Show more over what is loaded; when a section's loaded
//     page was full, "Show older" fetches the next page (loadMoreDocumentsAction).
import type { CdsDocument, ThreadFile } from "@cds/core/support";
import { Button, InlineAlert } from "@cds/ui/hub";
import {
  DocumentList,
  SUPPORT_UI_COPY,
  type DocumentFrom,
} from "@cds/ui/hub/support";
import { useEffect, useRef, useState } from "react";
import { mintSupportFileLinkAction } from "../../../actions/support";
import {
  loadMoreDocumentsAction,
  markDocumentsReadAction,
} from "../../../actions/support-lists";
import { GuardedLink } from "../GuardedLink";
import type { SupportAccess } from "./SupportFrame";
import { SUPPORT_COPY } from "./support-copy";

export interface DocumentsPanelProps {
  cdsDocs: CdsDocument[];
  files: ThreadFile[];
  /** Ids of CDS documents this person hasn't opened. */
  unreadIds: string[];
  from: DocumentFrom;
  /** The loaded page of each section was full: older rows may exist. */
  moreDocs: boolean;
  moreFiles: boolean;
  timeZone: string;
  access: SupportAccess;
  /** Tests inject; default location.assign. */
  navigate?(path: string): void;
}

function replaceFrom(from: DocumentFrom): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", "documents");
    if (from === "all") url.searchParams.delete("from");
    else url.searchParams.set("from", from);
    window.history.replaceState(window.history.state, "", url);
  } catch {
    // Link-state is a convenience; the filter still applies.
  }
}

export function DocumentsPanel({
  cdsDocs: initialDocs,
  files: initialFiles,
  unreadIds,
  from: initialFrom,
  moreDocs: initialMoreDocs,
  moreFiles: initialMoreFiles,
  timeZone,
  access,
  navigate,
}: DocumentsPanelProps) {
  const [from, setFrom] = useState<DocumentFrom>(initialFrom);
  const [docs, setDocs] = useState(initialDocs);
  const [files, setFiles] = useState(initialFiles);
  const [moreDocs, setMoreDocs] = useState(initialMoreDocs);
  const [moreFiles, setMoreFiles] = useState(initialMoreFiles);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const marked = useRef(false);

  useEffect(() => {
    if (marked.current) return;
    marked.current = true;
    if (access === "impersonating" || unreadIds.length === 0) return;
    // IN-C06: a rejected call (network drop, deploy skew) is never an unhandled rejection.
    void markDocumentsReadAction().catch(() => undefined);
  }, [access, unreadIds.length]);

  async function onDownload(id: string): Promise<string | null> {
    setError(null);
    const res = await mintSupportFileLinkAction(id).catch(() => null);
    if (!res) {
      setError(SUPPORT_UI_COPY.ERR_LOAD);
      return null;
    }
    if (res.ok) return res.data;
    setError(res.message);
    return null;
  }

  async function older(kind: "docs" | "files") {
    const list = kind === "docs" ? docs : files;
    const last = list[list.length - 1];
    if (!last || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await loadMoreDocumentsAction(
        kind,
        last.created,
        last.id,
      ).catch(() => null);
      if (!res) {
        setError(SUPPORT_UI_COPY.ERR_LOAD);
        return;
      }
      if (!res.ok) {
        setError(res.message);
        return;
      }
      if (res.data.kind === "docs") {
        const rows = res.data.rows;
        setDocs((d) => [
          ...d,
          ...rows.filter((r) => !d.some((x) => x.id === r.id)),
        ]);
        setMoreDocs(res.data.full);
      } else {
        const rows = res.data.rows;
        setFiles((f) => [
          ...f,
          ...rows.filter((r) => !f.some((x) => x.id === r.id)),
        ]);
        setMoreFiles(res.data.full);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4" data-documents-panel="">
      {error ? (
        <InlineAlert tone="error" data-documents-error="">
          {error}
        </InlineAlert>
      ) : null}
      <DocumentList
        cdsDocs={docs}
        files={files}
        from={from}
        onDownload={onDownload}
        onFilter={(v) => {
          setFrom(v);
          replaceFrom(v);
        }}
        timeZone={timeZone}
        unreadIds={unreadIds}
        LinkComponent={GuardedLink}
        navigate={navigate}
      />
      {moreDocs || moreFiles ? (
        <div className="flex flex-wrap gap-2">
          {moreDocs ? (
            <Button
              variant="ghost"
              size="sm"
              aria-busy={loading || undefined}
              onClick={() => void older("docs")}
              data-documents-older="docs"
            >
              {SUPPORT_COPY.showOlderDocs}
            </Button>
          ) : null}
          {moreFiles ? (
            <Button
              variant="ghost"
              size="sm"
              aria-busy={loading || undefined}
              onClick={() => void older("files")}
              data-documents-older="files"
            >
              {SUPPORT_COPY.showOlderFiles}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

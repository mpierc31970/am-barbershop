"use client";
// useSupportUploads (12-09 choice 3; COMM-08, D119; 12-UI-SPEC lines 340-347; RESEARCH
// Pitfall 5; T-12-09-03). The attachment queue behind the Composer, after useMediaUploads:
//   - Client pre-checks before anything is sent: ≤ 5 files a message, ≤ 10 MB each, and the
//     extension allowlist (mirrors @cds/db SUPPORT_FILE_TYPES). The server stays
//     authoritative (type by extension AND magic bytes, scan, rate limit; 12-07).
//   - One XHR POST per file to /hub/api/support/upload (the Server Action body cap is 2 MB),
//     one at a time in the order added, with upload progress.
//   - Each success holds the signed staging token; the composer passes ready tokens to
//     onSend. Failures keep the chip with the server's copy (or FILE-FAILED) and Try again.
// Never logs file names, bytes or tokens.
import { useCallback, useEffect, useRef, useState } from "react";
import { startXhr } from "../../media/xhr";
import { SUPPORT_UI_COPY } from "../copy";

export const SUPPORT_UPLOAD_URL = "/hub/api/support/upload";
export const SUPPORT_UPLOAD_MAX_FILES = 5;
export const SUPPORT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
/** Mirrors @cds/db SUPPORT_FILE_TYPES (12-07): images, PDF, text, CSV, Office. */
export const SUPPORT_UPLOAD_EXTENSIONS = Object.freeze([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "pdf",
  "txt",
  "csv",
  "docx",
  "xlsx",
  "pptx",
] as const);
/** The `accept` attribute for the file picker. */
export const SUPPORT_UPLOAD_ACCEPT = SUPPORT_UPLOAD_EXTENSIONS.map(
  (e) => `.${e}`,
).join(",");

export type SupportUploadStatus = "queued" | "uploading" | "ready" | "error";

export type SupportUploadItem = {
  key: string;
  name: string;
  size: number;
  status: SupportUploadStatus;
  pct: number;
  token: string | null;
  scan: "clean" | "pending" | null;
  message?: string;
};

export interface UseSupportUploadsOptions {
  url?: string;
  maxFiles?: number;
  maxBytes?: number;
}

export interface SupportUploads {
  items: SupportUploadItem[];
  /** Queue files; returns the refusal messages (FILE-TOO-MANY, FILE-TOO-BIG, FILE-TYPE). */
  add(files: readonly File[]): string[];
  remove(key: string): void;
  retry(key: string): void;
  clear(): void;
  /** Tokens of the ready files, in order. */
  tokens: string[];
  /** A file is still queued or uploading. */
  busy: boolean;
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

/** Client pre-check for one file: null when it may be sent, else the refusal copy. */
export function checkSupportFile(
  file: File,
  maxBytes = SUPPORT_UPLOAD_MAX_BYTES,
): string | null {
  if (
    !(SUPPORT_UPLOAD_EXTENSIONS as readonly string[]).includes(extOf(file.name))
  ) {
    return SUPPORT_UI_COPY.FILE_TYPE(file.name);
  }
  if (file.size > maxBytes) return SUPPORT_UI_COPY.FILE_TOO_BIG(file.name);
  return null;
}

let seq = 0;

export function useSupportUploads(
  opts: UseSupportUploadsOptions = {},
): SupportUploads {
  const url = opts.url ?? SUPPORT_UPLOAD_URL;
  const maxFiles = opts.maxFiles ?? SUPPORT_UPLOAD_MAX_FILES;
  const maxBytes = opts.maxBytes ?? SUPPORT_UPLOAD_MAX_BYTES;
  const [items, setItems] = useState<SupportUploadItem[]>([]);
  const itemsRef = useRef<SupportUploadItem[]>([]);
  const files = useRef(new Map<string, File>());
  const queue = useRef<string[]>([]);
  const running = useRef<{ key: string; abort(): void } | null>(null);
  const mounted = useRef(true);

  const commit = useCallback((next: SupportUploadItem[]) => {
    itemsRef.current = next;
    if (mounted.current) setItems(next);
  }, []);

  const patch = useCallback(
    (key: string, p: Partial<SupportUploadItem>) => {
      commit(itemsRef.current.map((t) => (t.key === key ? { ...t, ...p } : t)));
    },
    [commit],
  );

  const pump = useCallback(() => {
    if (running.current || !mounted.current) return;
    const key = queue.current.shift();
    if (key === undefined) return;
    const file = files.current.get(key);
    if (!file) {
      pump();
      return;
    }
    patch(key, { status: "uploading", pct: 0, message: undefined });
    const body = new FormData();
    body.append("file", file, file.name);
    const handle = startXhr(
      {
        method: "POST",
        url,
        body,
        onProgress: (loaded, total) => {
          patch(key, { pct: Math.min(99, Math.round((loaded / total) * 100)) });
        },
      },
      (outcome) => {
        running.current = null;
        if (!mounted.current) return;
        if (!files.current.has(key)) {
          pump();
          return;
        }
        if (outcome.ok && outcome.result.status === 200) {
          const token = outcome.result.json.token;
          const scan = outcome.result.json.scan;
          if (typeof token === "string" && token) {
            patch(key, {
              status: "ready",
              pct: 100,
              token,
              scan: scan === "pending" ? "pending" : "clean",
            });
            pump();
            return;
          }
        }
        if (outcome.ok || outcome.error.name !== "AbortError") {
          const server =
            outcome.ok && typeof outcome.result.json.error === "string"
              ? outcome.result.json.error
              : "";
          patch(key, {
            status: "error",
            pct: 0,
            message: server || SUPPORT_UI_COPY.FILE_FAILED(file.name),
          });
        }
        pump();
      },
    );
    running.current = { key, abort: handle.abort };
  }, [patch, url]);

  const add = useCallback(
    (picked: readonly File[]): string[] => {
      const refusals: string[] = [];
      const fresh: SupportUploadItem[] = [];
      // Every chip holds a slot, failed ones too: Try again re-queues a failed file, so
      // counting only live ones let a 6th token through (12-REVIEW IN-D02).
      let count = itemsRef.current.length;
      let tooMany = false;
      for (const file of picked) {
        const refused = checkSupportFile(file, maxBytes);
        if (refused) {
          refusals.push(refused);
          continue;
        }
        if (count >= maxFiles) {
          tooMany = true;
          continue;
        }
        seq += 1;
        const key = `s${seq}`;
        files.current.set(key, file);
        queue.current.push(key);
        fresh.push({
          key,
          name: file.name,
          size: file.size,
          status: "queued",
          pct: 0,
          token: null,
          scan: null,
        });
        count += 1;
      }
      if (tooMany) refusals.push(SUPPORT_UI_COPY.FILE_TOO_MANY);
      if (fresh.length > 0) {
        commit([...itemsRef.current, ...fresh]);
        pump();
      }
      return refusals;
    },
    [commit, maxBytes, maxFiles, pump],
  );

  const remove = useCallback(
    (key: string) => {
      files.current.delete(key);
      queue.current = queue.current.filter((k) => k !== key);
      if (running.current?.key === key) running.current.abort();
      commit(itemsRef.current.filter((t) => t.key !== key));
    },
    [commit],
  );

  const retry = useCallback(
    (key: string) => {
      if (!files.current.has(key)) return;
      const live = itemsRef.current.filter(
        (t) => t.key !== key && t.status !== "error",
      ).length;
      if (live >= maxFiles) {
        patch(key, { message: SUPPORT_UI_COPY.FILE_TOO_MANY });
        return;
      }
      patch(key, { status: "queued", pct: 0, message: undefined });
      queue.current.push(key);
      pump();
    },
    [maxFiles, patch, pump],
  );

  const clear = useCallback(() => {
    files.current.clear();
    queue.current = [];
    const run = running.current;
    running.current = null;
    run?.abort();
    commit([]);
  }, [commit]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      running.current?.abort();
    };
  }, []);

  const tokens = items
    .filter((t) => t.status === "ready" && t.token)
    .map((t) => t.token as string);
  const busy = items.some(
    (t) => t.status === "queued" || t.status === "uploading",
  );
  return { items, add, remove, retry, clear, tokens, busy };
}

"use client";
// useMediaUploads: the upload queue behind Website › Media and the picker's Upload tab (07-17;
// CONT-14, CONT-19; 07-UI-SPEC "Upload states"). One tile per file:
//   - checkMediaFile runs at once; a refused file becomes an error tile and is never sent.
//   - Files upload one at a time in the order picked (choice 3): photos in one POST, MP4/MP3
//     in ≤ 8 MiB parts (media/upload.ts).
//   - stop(key) aborts the running file (the chunk upload sends DELETE) or drops a queued one;
//     remove(key) clears an error tile.
//   - Each success calls onUploaded(assetId, kind) and drops its tile; when the queue empties,
//     onBatchDone({ images, videos, audio, failed }).
// `kinds` restricts the picker to its kind: another kind gets that kind's type copy.
import { useCallback, useEffect, useRef, useState } from "react";
import { UPL_COPY } from "./media/p6-copy";
import { MEDIA_COPY, type MediaKind } from "./media/copy";
import {
  checkMediaFile,
  uploadChunkedFile,
  uploadImageFile,
  type UploadOptions,
  type UploadResult,
} from "./media/upload";

export type UploadTileView = {
  key: string;
  name: string;
  kind: MediaKind | null;
  preview: string | null;
  status: "queued" | "uploading" | "processing" | "error";
  pct: number;
  message?: string;
};

export type MediaUploader = {
  image(file: File, opts: UploadOptions): Promise<UploadResult>;
  chunked(
    file: File,
    kind: "video" | "audio",
    opts: UploadOptions,
  ): Promise<UploadResult>;
};

export const defaultMediaUploader: MediaUploader = {
  image: uploadImageFile,
  chunked: uploadChunkedFile,
};

export type UploadBatchSummary = {
  images: number;
  videos: number;
  audio: number;
  failed: number;
};

export interface UseMediaUploadsOptions {
  onUploaded?(assetId: string, kind: MediaKind): void;
  onBatchDone?(summary: UploadBatchSummary): void;
  uploader?: MediaUploader;
  kinds?: readonly MediaKind[];
}

export interface MediaUploads {
  tiles: UploadTileView[];
  add(files: readonly File[]): void;
  stop(key: string): void;
  remove(key: string): void;
  busy: boolean;
}

const WRONG_KIND: Record<MediaKind, string> = {
  image: UPL_COPY.type,
  video: MEDIA_COPY.videoType,
  audio: MEDIA_COPY.audio,
};

type Job = { key: string; file: File; kind: MediaKind };

function objectUrl(file: File): string | null {
  try {
    return typeof URL.createObjectURL === "function"
      ? URL.createObjectURL(file)
      : null;
  } catch {
    return null;
  }
}

function revoke(url: string | null): void {
  if (url && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(url);
  }
}

const EMPTY_BATCH: UploadBatchSummary = {
  images: 0,
  videos: 0,
  audio: 0,
  failed: 0,
};

let seq = 0;

export function useMediaUploads(
  opts: UseMediaUploadsOptions = {},
): MediaUploads {
  const [tiles, setTiles] = useState<UploadTileView[]>([]);
  const latest = useRef(opts);
  useEffect(() => {
    latest.current = opts;
  });
  const queue = useRef<Job[]>([]);
  const running = useRef<{ key: string; ctl: AbortController } | null>(null);
  const batch = useRef<UploadBatchSummary | null>(null);
  const previews = useRef(new Map<string, string | null>());
  const mounted = useRef(true);

  const patch = useCallback((key: string, p: Partial<UploadTileView>) => {
    setTiles((list) => list.map((t) => (t.key === key ? { ...t, ...p } : t)));
  }, []);

  const drop = useCallback((key: string) => {
    revoke(previews.current.get(key) ?? null);
    previews.current.delete(key);
    setTiles((list) => list.filter((t) => t.key !== key));
  }, []);

  const pump = useCallback(() => {
    if (running.current || !mounted.current) return;
    const job = queue.current.shift();
    if (!job) {
      const done = batch.current;
      batch.current = null;
      if (done) latest.current.onBatchDone?.(done);
      return;
    }
    const ctl = new AbortController();
    running.current = { key: job.key, ctl };
    patch(job.key, { status: "uploading", pct: 0 });
    const uploader = latest.current.uploader ?? defaultMediaUploader;
    const options: UploadOptions = {
      signal: ctl.signal,
      onProgress: (f) => {
        const pct = Math.min(100, Math.round(f * 100));
        patch(
          job.key,
          pct >= 100 ? { status: "processing", pct: 100 } : { pct },
        );
      },
    };
    const run =
      job.kind === "image"
        ? uploader.image(job.file, options)
        : uploader.chunked(job.file, job.kind, options);
    void run
      .catch((): UploadResult => ({ ok: false, message: MEDIA_COPY.failed }))
      .then((res) => {
        running.current = null;
        if (!mounted.current) return;
        const b = (batch.current ??= { ...EMPTY_BATCH });
        if (res.ok) {
          if (job.kind === "image") b.images += 1;
          else if (job.kind === "video") b.videos += 1;
          else b.audio += 1;
          drop(job.key);
          latest.current.onUploaded?.(res.assetId, job.kind);
        } else if (res.aborted) {
          drop(job.key);
        } else {
          b.failed += 1;
          patch(job.key, { status: "error", message: res.message });
        }
        pump();
      });
  }, [drop, patch]);

  const add = useCallback(
    (files: readonly File[]) => {
      const allowed = latest.current.kinds;
      const fresh: UploadTileView[] = [];
      let queued = 0;
      for (const file of files) {
        seq += 1;
        const key = `u${seq}`;
        const check = checkMediaFile(file);
        let message: string | null = null;
        let kind: MediaKind | null = null;
        if ("error" in check) message = check.error;
        else if (allowed && !allowed.includes(check.kind)) {
          message = WRONG_KIND[allowed[0] ?? "image"];
        } else kind = check.kind;
        if (message !== null || kind === null) {
          fresh.push({
            key,
            name: file.name,
            kind: "error" in check ? null : check.kind,
            preview: null,
            status: "error",
            pct: 0,
            message: message ?? MEDIA_COPY.failed,
          });
          if (batch.current) batch.current.failed += 1;
          continue;
        }
        const preview = kind === "image" ? objectUrl(file) : null;
        previews.current.set(key, preview);
        fresh.push({
          key,
          name: file.name,
          kind,
          preview,
          status: "queued",
          pct: 0,
        });
        queue.current.push({ key, file, kind });
        queued += 1;
      }
      if (queued > 0 && !batch.current) {
        batch.current = {
          ...EMPTY_BATCH,
          failed: fresh.filter((t) => t.status === "error").length,
        };
      }
      setTiles((list) => [...list, ...fresh]);
      pump();
    },
    [pump],
  );

  const stop = useCallback(
    (key: string) => {
      if (running.current?.key === key) {
        running.current.ctl.abort();
        return;
      }
      queue.current = queue.current.filter((j) => j.key !== key);
      drop(key);
    },
    [drop],
  );

  const remove = useCallback(
    (key: string) => {
      queue.current = queue.current.filter((j) => j.key !== key);
      drop(key);
    },
    [drop],
  );

  useEffect(() => {
    mounted.current = true;
    const map = previews.current;
    return () => {
      mounted.current = false;
      running.current?.ctl.abort();
      for (const url of map.values()) revoke(url);
    };
  }, []);

  const busy = tiles.some((t) => t.status !== "error");
  return { tiles, add, stop, remove, busy };
}

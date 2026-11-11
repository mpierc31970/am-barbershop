// P6 upload copy and size rules (06-19), moved out of the "use client" ImageUpload in 07-17 so
// server-safe modules (hub/media/copy.ts, upload.ts) can import the strings themselves; a
// value exported from a "use client" module is a client reference on the server. ImageUpload
// re-exports every name unchanged; apps/web/test/media-actions.test.ts pins them to @cds/db.
// Pure: no React.
export const ACCEPT = "image/jpeg,image/png,image/webp";
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MB = 1024 * 1024;

export const UPL_COPY = {
  tooBig: (bytes: number) =>
    `This photo is ${Math.max(21, Math.ceil(bytes / MB))} MB. The limit is 20 MB: export a smaller copy and try again.`,
  type: "This file isn't a photo we can use. Upload a JPEG, PNG or WebP.",
  heic: "We couldn't read this iPhone photo. Save it as a JPEG and try again.",
  failed: "The upload didn't finish. Check your connection and try again.",
} as const;

export const PROCESSING_COPY = "Making web-ready copies…";
export const PHOTO_REMOVED_COPY = "Photo removed.";
export const ALT_MISSING_COPY =
  "Add a short description of the photo for people who can't see it.";
/** A description save that failed (B-WR-07); leaving the field again retries it. */
export const ALT_SAVE_FAILED_COPY =
  "That description didn't save. Leave the field again to retry.";
export const ALT_HELPER =
  "Describe the photo for people who can't see it, like 'Loaves cooling on a rack'.";

/** "1.8 MB" / "640 KB". */
export function formatBytes(bytes: number): string {
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

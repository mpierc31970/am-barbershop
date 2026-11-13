"use client";
// A&M fork: the camera button posts as soon as a photo is picked; "Upload photo" is the
// fallback if the browser doesn't fire the change.
import { Camera } from "lucide-react";
import { useState } from "react";

export function PhotoPicker({ seatId }: { seatId: string }) {
  const [sending, setSending] = useState(false);
  return (
    <form
      method="post"
      action="/hub/api/studio/photo"
      encType="multipart/form-data"
      className="flex flex-col gap-4"
      onSubmit={() => setSending(true)}
    >
      <input type="hidden" name="seatId" value={seatId} />
      <input type="hidden" name="target" value="gallery" />
      <label className="flex min-h-16 cursor-pointer items-center justify-center gap-3 rounded bg-hub-accent px-6 text-lg font-semibold text-hub-surface">
        <Camera aria-hidden="true" size={24} strokeWidth={2} />
        {sending ? "Sending…" : "Open camera"}
        <input
          type="file"
          name="file"
          accept="image/*"
          capture="environment"
          required
          className="sr-only"
          onChange={(e) => {
            if (e.currentTarget.files?.length) {
              setSending(true);
              e.currentTarget.form?.submit();
            }
          }}
        />
      </label>
      <button
        type="submit"
        className="min-h-11 rounded border border-hub-border px-4 text-base"
      >
        Upload photo
      </button>
    </form>
  );
}

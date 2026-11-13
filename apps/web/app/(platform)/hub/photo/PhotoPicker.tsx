"use client";
// A&M fork: the camera button posts as soon as a photo is picked; "Upload photo" is the
// fallback if the browser doesn't fire the change. While it sends, an upload timer shows.
import { Camera } from "lucide-react";
import { useState } from "react";
import { sendPhotoForm, ShrinkFileInput } from "./ShrinkFileInput";
import { Uploading } from "./Uploading";

export function PhotoPicker({ seatId }: { seatId: string }) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  async function send(form: HTMLFormElement) {
    setSending(true);
    setError("");
    const msg = await sendPhotoForm(form);
    setSending(false);
    setError(msg);
  }
  return (
    <form
      method="post"
      action="/hub/api/studio/photo"
      encType="multipart/form-data"
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void send(e.currentTarget);
      }}
    >
      <input type="hidden" name="seatId" value={seatId} />
      <input type="hidden" name="target" value="gallery" />
      {sending ? <Uploading /> : null}
      <label
        className={`${sending ? "hidden" : "flex"} min-h-16 cursor-pointer items-center justify-center gap-3 rounded bg-hub-accent px-6 text-lg font-semibold text-hub-surface`}
      >
        <Camera aria-hidden="true" size={24} strokeWidth={2} />
        Open camera
        <ShrinkFileInput
          name="file"
          accept="image/*"
          capture="environment"
          required
          className="sr-only"
          onStart={() => setSending(true)}
          onError={(m) => {
            setSending(false);
            setError(m);
          }}
          onReady={(input) => {
            if (input.form) void send(input.form);
          }}
        />
      </label>
      {error ? (
        <p role="alert" className="text-base text-hub-danger">
          {error}
        </p>
      ) : null}
      {sending ? null : (
        <button
          type="submit"
          className="min-h-11 rounded border border-hub-border px-4 text-base"
        >
          Upload photo
        </button>
      )}
    </form>
  );
}

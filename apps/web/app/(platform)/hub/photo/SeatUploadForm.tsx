"use client";
// A&M fork: the profile screen's portrait / logo / gallery upload. The photo shrinks on pick
// (ShrinkFileInput); after Upload, the upload timer replaces the form until the page returns.
import { Button } from "@cds/ui/hub";
import { useState } from "react";
import { sendPhotoForm, ShrinkFileInput } from "./ShrinkFileInput";
import { Uploading } from "./Uploading";

export function SeatUploadForm({
  seatId,
  target,
  label,
}: {
  seatId: string;
  target: "photo" | "gallery" | "logo";
  label: string;
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      method="post"
      action="/hub/api/studio/photo"
      encType="multipart/form-data"
      className="flex flex-wrap items-end gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        setSending(true);
        setError("");
        const msg = await sendPhotoForm(form);
        setSending(false);
        setError(msg);
      }}
    >
      <input type="hidden" name="seatId" value={seatId} />
      <input type="hidden" name="target" value={target} />
      {sending ? <Uploading /> : null}
      <label
        className={`${sending ? "hidden" : "flex"} flex-col gap-2 text-sm font-semibold`}
      >
        {label}
        <ShrinkFileInput
          name="file"
          required
          accept="image/jpeg,image/png,image/webp,image/heic"
          className="text-base font-normal"
        />
      </label>
      {error ? (
        <p role="alert" className="w-full text-base text-hub-danger">
          {error}
        </p>
      ) : null}
      {sending ? null : (
        <Button type="submit" size="sm">
          Upload
        </Button>
      )}
    </form>
  );
}

"use client";
// A&M fork: phone-library photos (48 MP iPhone shots turned into JPEG) can pass the 20 MB
// upload cap, and an over-cap post just hangs. On pick, the photo is redrawn in the browser
// as a JPEG no wider or taller than 2560 px (what the media pipeline keeps anyway) and put
// back in the input, so the plain form posts the small copy. If the browser can't redraw
// it, the original goes as-is; if that is still over the cap, an error shows instead.
import { useState, type InputHTMLAttributes } from "react";

const MAX_SIDE = 2560;
const MAX_BYTES = 20 * 1024 * 1024;
const SHRINK_OVER = 3 * 1024 * 1024;

async function shrink(file: File): Promise<File> {
  if (file.size <= SHRINK_OVER && file.type === "image/jpeg") return file;
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob = await new Promise<Blob | null>((r) =>
    canvas.toBlob(r, "image/jpeg", 0.88),
  );
  if (!blob) return file;
  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], name, { type: "image/jpeg" });
}

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "onChange" | "onError"
> & {
  /** Runs after the input holds the shrunk photo (e.g. submit the form). */
  onReady?: (input: HTMLInputElement) => void;
  /** Shows the error elsewhere instead of right after the input. */
  onError?: (message: string) => void;
};

export function ShrinkFileInput({ onReady, onError, ...rest }: Props) {
  const [own, setOwn] = useState("");
  const setError = onError ?? setOwn;
  const error = onError ? "" : own;
  return (
    <>
      <input
        {...rest}
        type="file"
        onChange={async (e) => {
          const input = e.currentTarget;
          const file = input.files?.[0];
          setError("");
          if (!file) return;
          let out = file;
          try {
            out = await shrink(file);
            if (out !== file) {
              const dt = new DataTransfer();
              dt.items.add(out);
              input.files = dt.files;
            }
          } catch {
            out = file;
          }
          if (out.size > MAX_BYTES) {
            input.value = "";
            setError(
              "This photo is too large to upload. Try a different photo or take a new one.",
            );
            return;
          }
          onReady?.(input);
        }}
      />
      {error ? (
        <span role="alert" className="text-base font-normal text-hub-danger">
          {error}
        </span>
      ) : null}
    </>
  );
}

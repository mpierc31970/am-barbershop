"use client";
// A&M fork: shown while a photo is being prepared and sent: a spinning ring around a
// seconds counter, so a slow phone connection reads as "working", not "stuck".
import { useEffect, useState } from "react";

export function Uploading() {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div
      role="status"
      className="flex items-center gap-4 rounded border border-hub-border bg-hub-surface p-4"
    >
      <span className="relative inline-flex size-14 shrink-0 items-center justify-center">
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full border-4 border-hub-border border-t-hub-accent motion-safe:animate-spin"
        />
        <span className="text-sm font-semibold tabular-nums" aria-hidden="true">
          {secs}s
        </span>
      </span>
      <span className="text-base font-semibold">
        Uploading your photo… Keep this screen open.
      </span>
    </div>
  );
}

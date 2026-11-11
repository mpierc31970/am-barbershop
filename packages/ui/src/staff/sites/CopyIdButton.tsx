"use client";
// Copy the org id (13-33; 13-UI-SPEC site detail "org id (copy)"). A ghost sm button that writes
// the id to the clipboard and says "Copied" for 2 seconds (polite). No clipboard: nothing
// happens and the id stays selectable next to it.
import { Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../hub/Button";
import { SITES_COPY as C } from "./copy";

export function CopyIdButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <span className="inline-flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        icon={<Copy aria-hidden size={16} strokeWidth={2} />}
        aria-label={C.overview.copyId}
        onClick={() => {
          void navigator.clipboard
            ?.writeText(value)
            .then(() => setCopied(true))
            .catch(() => undefined);
        }}
      >
        {copied ? C.overview.copied : null}
      </Button>
      <span aria-live="polite" className="sr-only">
        {copied ? C.overview.copied : ""}
      </span>
    </span>
  );
}

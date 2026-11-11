"use client";
// The collapsed "Proof code" on the signed confirmation (09-18; D-UI-P9-10; 09-UI-SPEC
// "Signed confirmation" item 6): the evidence hash in monospace, wrapping anywhere, with a
// ghost Copy button (toast "Copied"). A browser without clipboard access gets a toast asking
// to select the code instead; the code stays selectable either way.
import { Button, useToast } from "@cds/ui/hub";
import { Copy } from "lucide-react";
import { useId } from "react";

export function ProofCode({
  code,
  label,
  helper,
}: {
  code: string;
  label: string;
  helper: string;
}) {
  const toast = useToast();
  const codeId = useId();

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      toast.show({ message: "Copied" });
    } catch {
      toast.show({ message: "Couldn't copy. Select the code and copy it." });
    }
  }

  return (
    <details className="group rounded border border-hub-border bg-hub-surface">
      <summary className="cursor-pointer rounded px-4 py-3 text-sm font-semibold text-hub-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent">
        {label}
      </summary>
      <div className="flex flex-col gap-3 border-t border-hub-border px-4 py-3">
        <p className="text-sm text-hub-ink-muted">{helper}</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <code
            id={codeId}
            className="font-mono text-sm break-all text-hub-ink select-all"
          >
            {code}
          </code>
          <Button
            variant="ghost"
            size="sm"
            icon={<Copy size={16} aria-hidden="true" />}
            aria-describedby={codeId}
            onClick={() => void copy()}
          >
            Copy
          </Button>
        </div>
      </div>
    </details>
  );
}

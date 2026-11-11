"use client";
// Builder preview: "Open on your preview address" and "Copy preview link" (14-20 choice 2;
// 14-UI-SPEC "Draft preview links"; DOM-07, D22). Both mint a fresh signed 60-minute link
// through a POST Server Action on click (never at render), so every link is audited. Open uses
// window.open(url, "_blank", "noopener"); a blocked pop-up falls back to the manual link field.
// Copy writes the link to the clipboard ("Copied" for 2 s) or shows it in a read-only field to
// copy by hand. PREVIEW-LINK-HELP shows under the buttons once per browser session.
// Sits on the dark preview strip, so the ghost button and the help line use surface ink.
import { P14_COPY } from "@cds/core/dns";
import { Button, useToast } from "@cds/ui/hub";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { mintPreviewLinkAction } from "../../../../../../actions/preview-link";

const HELP_FLAG = "cds:preview-link-help";
const COPIED_MS = 2000;
const MANUAL_LABEL = "Copy this link:";
const MINT_FAILED = "We couldn't make a preview link. Try again in a minute.";

export function PreviewLinkButton({ pageId }: { pageId: string }) {
  const toast = useToast();
  const id = useId();
  const [busy, setBusy] = useState<"open" | "copy" | null>(null);
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(HELP_FLAG) === null) {
        window.sessionStorage.setItem(HELP_FLAG, "1");
        setHelp(true);
      }
    } catch {
      // Storage blocked: never show the line rather than show it on every load.
    }
  }, []);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(t);
  }, [copied]);

  useEffect(() => {
    if (manual) fieldRef.current?.select();
  }, [manual]);

  async function mint(): Promise<string | null> {
    try {
      const res = await mintPreviewLinkAction(pageId);
      if (!res.ok) {
        toast.show({ message: res.message });
        return null;
      }
      return res.data.url;
    } catch {
      toast.show({ message: MINT_FAILED });
      return null;
    }
  }

  async function open() {
    setBusy("open");
    // Opened before the await so pop-up blockers see the click; pointed at the link after.
    const win = window.open("", "_blank");
    try {
      const url = await mint();
      if (!url) {
        win?.close();
        return;
      }
      if (win) {
        win.opener = null;
        win.location.href = url;
      } else if (!window.open(url, "_blank", "noopener")) {
        setManual(url);
      }
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    setBusy("copy");
    try {
      const url = await mint();
      if (!url) return;
      try {
        if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
        await navigator.clipboard.writeText(url);
        setManual(null);
        setCopied(true);
        toast.show({ message: "Preview link copied." });
      } catch {
        setManual(url);
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon={<ExternalLink aria-hidden size={16} strokeWidth={2} />}
          loading={busy === "open"}
          onClick={() => void open()}
        >
          {P14_COPY.BTN_OPEN_ON_PREVIEW}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-hub-surface! hover:text-hub-ink!"
          icon={
            copied ? (
              <Check aria-hidden size={16} strokeWidth={2} />
            ) : (
              <Copy aria-hidden size={16} strokeWidth={2} />
            )
          }
          loading={busy === "copy"}
          onClick={() => void copy()}
        >
          {copied ? "Copied" : P14_COPY.BTN_COPY_PREVIEW_LINK}
        </Button>
      </div>
      {help ? (
        <p className="text-sm text-hub-surface opacity-85">
          {P14_COPY.PREVIEW_LINK_HELP}
        </p>
      ) : null}
      {manual ? (
        <div className="flex w-full max-w-80 flex-col gap-1">
          <label htmlFor={`${id}-link`} className="text-sm font-semibold">
            {MANUAL_LABEL}
          </label>
          <input
            ref={fieldRef}
            id={`${id}-link`}
            readOnly
            value={manual}
            onFocus={(e) => e.currentTarget.select()}
            className="h-10 w-full rounded border border-hub-border-strong bg-hub-surface px-3 font-hub text-sm text-hub-ink"
          />
        </div>
      ) : null}
    </div>
  );
}

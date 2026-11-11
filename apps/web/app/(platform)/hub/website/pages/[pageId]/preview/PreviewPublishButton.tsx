"use client";
// The preview strip's Publish changes button (CONT-30; 03-UI-SPEC "Preview"). Same Server
// Action as the builder header; the result is announced through the hub toast region and
// the page refreshes. Kept apart from Builder.tsx so the preview ships a small bundle.
import { Button, useToast } from "@cds/ui/hub";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { publishPageAction } from "../../../../../../actions/publish";

// UI-SPEC copy (same strings as @cds/ui/builder; importing that barrel here would pull the
// whole editor into the preview bundle).
const HELD_LINE =
  "This page is being reviewed, usually within 2 business days.";
const ERR_PUBLISH_COPY =
  "Publishing didn't finish. Your draft is safe and your live page hasn't changed. Try again in a minute.";

export function PreviewPublishButton({ pageId }: { pageId: string }) {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="primary"
      size="sm"
      loading={busy}
      loadingLabel="Publishing…"
      onClick={async () => {
        setBusy(true);
        try {
          const res = await publishPageAction(pageId);
          if (!res.ok) toast.show({ message: res.message });
          else if (res.data.status === "held")
            toast.show({ message: HELD_LINE });
          else toast.show({ message: "Published. Your changes are live." });
          router.refresh();
        } catch {
          toast.show({ message: ERR_PUBLISH_COPY });
        } finally {
          setBusy(false);
        }
      }}
    >
      Publish changes
    </Button>
  );
}

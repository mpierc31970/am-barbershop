"use client";
// Hub error boundary (03-UI-SPEC copy ERR-LOAD; 03-UI-REVIEW Fix 3). Any unexpected
// failure inside the hub (a builder or preview load that rethrows) shows the standard
// "We couldn't load this" alert with Try again, inside the hub chrome, instead of Next's
// default error screen. Try again re-fetches the server data, then re-renders the segment.
import { Button, InlineAlert } from "@cds/ui/hub";
import { usePathname, useRouter } from "next/navigation";
import { startTransition, useEffect } from "react";
import { contentMode } from "./HubShell";

export default function HubError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  // Standard screens already sit in the shell's padded frame; builder and preview don't.
  const framed = contentMode(usePathname() ?? "") === "standard";

  useEffect(() => {
    console.error("[hub] render failed", error.digest ?? error);
  }, [error]);

  return (
    <div
      className={
        framed ? "max-w-[720px]" : "max-w-[720px] px-4 py-6 md:px-8 md:py-8"
      }
    >
      <InlineAlert
        tone="error"
        action={
          <Button
            size="sm"
            onClick={() =>
              startTransition(() => {
                router.refresh();
                reset();
              })
            }
          >
            Try again
          </Button>
        }
      >
        We couldn&apos;t load this. Check your connection and try again.
      </InlineAlert>
    </div>
  );
}

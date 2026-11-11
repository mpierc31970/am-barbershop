// ERR-LOAD for the Sites list and site detail panels (13-33; 13-UI-SPEC "Sites" error state,
// P11 copy unchanged): an error InlineAlert with a "Try again" link back to the same view.
import { InlineAlert } from "@cds/ui/hub";
import { SUPPORT_UI_COPY } from "@cds/ui/hub/support";

export function SitesLoadError({ href }: { href: string }) {
  return (
    <InlineAlert
      tone="error"
      action={
        <a
          href={href}
          className="rounded font-semibold underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
        >
          Try again
        </a>
      }
    >
      {SUPPORT_UI_COPY.ERR_LOAD}
    </InlineAlert>
  );
}

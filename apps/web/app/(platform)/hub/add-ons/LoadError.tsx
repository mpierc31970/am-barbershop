// ERR-LOAD for the Get add-ons screens (03-UI-SPEC copy): InlineAlert + Try again.
import { InlineAlert, buttonClasses } from "@cds/ui/hub";
import Link from "next/link";

export function LoadError({ href }: { href: string }) {
  return (
    <InlineAlert
      tone="error"
      action={
        <Link href={href} className={buttonClasses("secondary", "sm")}>
          Try again
        </Link>
      }
    >
      We couldn&apos;t load this. Check your connection and try again.
    </InlineAlert>
  );
}

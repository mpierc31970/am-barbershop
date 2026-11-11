// /legal not-found (09-09; 09-UI-SPEC "Public policy pages": unknown key or version -> the
// not-found page). The platform host has no root not-found, so the legal segment renders the
// P7 not-found copy inside the legal frame. Next sets the 404 status and noindex.
import { NOT_FOUND_COPY } from "@cds/ui/site";
import Link from "next/link";
import { LegalFrame } from "./_components/LegalFrame";

export default function LegalNotFound() {
  return (
    <LegalFrame>
      <div className="flex max-w-[68ch] flex-col gap-4">
        <h1 className="text-[1.75rem] leading-[1.2] font-semibold">
          {NOT_FOUND_COPY.title}
        </h1>
        <p className="text-base text-hub-ink-muted">{NOT_FOUND_COPY.body}</p>
        <p>
          <Link
            href="/legal/terms-of-service"
            className="text-hub-accent underline underline-offset-4"
          >
            Read the Terms of Service
          </Link>
        </p>
      </div>
    </LegalFrame>
  );
}

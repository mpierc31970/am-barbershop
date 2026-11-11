// /unsubscribe (15-18; HUB-03, A1-Q5, P15-P11; UI-SPEC "Read pages"). The old site's newsletter
// unsubscribe links land here (GET /api/newsletter/unsubscribe 301s to it, 15-22). The list lives
// in the old site's database and has ended, so there is nothing to act on: the page only says so.
// Always noindex, in every environment. Dynamic per request, no ISR (P15-P3).
import { MK_COPY } from "@cds/core/marketing";
import { ChipField, MkLinkButton, ProseBlock } from "@cds/ui/marketing";
import type { Metadata } from "next";
import { MK_READ_H1, MK_READ_WRAP } from "../_components/read";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: MK_COPY.SEO.UNSUB_TITLE,
    robots: { index: false, follow: false },
  };
}

export default function UnsubscribePage() {
  const U = MK_COPY.UNSUB;
  return (
    <ChipField field="card" aria-labelledby="mk-unsub-h1">
      <div className={MK_READ_WRAP}>
        <ProseBlock className="flex flex-col items-start gap-6">
          <h1 id="mk-unsub-h1" className={MK_READ_H1}>
            {U.H1}
          </h1>
          <p>{U.BODY}</p>
          <MkLinkButton href="/" variant="text">
            {U.BACK_HOME}
          </MkLinkButton>
        </ProseBlock>
      </div>
    </ChipField>
  );
}

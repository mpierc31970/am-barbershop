// /hosting-rules (15-18; D215, D249; UI-SPEC "Read pages"). Read mode: card ground, 68ch column,
// billboard H1 and nothing else large.
// - "We don't host" / "We review these first" are built inline from AUP_CATEGORIES by verdict
//   (the same source as the /start FAQ and the FitChecker; not start-logic's aupLines, which
//   the marketing boundary forbids importing).
// - "If a live site breaks these rules" is the compiled Acceptable Use Policy's own "Taking a site
//   down" section, rendered through renderLegalMarkdown (escape-first subset, T-15-18-01), so the
//   page can never say something the signed policy doesn't.
// - Indexed in production (hubRobots). Dynamic per request, no ISR (P15-P3).
import { activePolicyVersions, renderLegalMarkdown } from "@cds/core/legal";
import { MK_COPY } from "@cds/core/marketing";
import { AUP_CATEGORIES, type AupVerdict } from "@cds/core/onboarding";
import { ChipField, ProseBlock } from "@cds/ui/marketing";
import type { Metadata } from "next";
import Link from "next/link";
import { hubCanonical, hubRobots } from "../../../../lib/hub-env";
import {
  MK_LEGAL_HTML,
  MK_READ_H1,
  MK_READ_H2,
  MK_READ_WRAP,
} from "../_components/read";

export const dynamic = "force-dynamic";

const TAKEDOWN_HEADING = "## Taking a site down";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: MK_COPY.SEO.HOSTING_TITLE,
    description: MK_COPY.HOSTING.LEAD,
    robots: hubRobots(),
    alternates: { canonical: hubCanonical("/hosting-rules") },
  };
}

/** The AUP's "Taking a site down" section as HTML, or null when the policy has none. */
function takedownHtml(): string | null {
  const aup = activePolicyVersions().find((p) => p.key === "acceptable-use");
  if (!aup) return null;
  const lines = aup.bodyMd.split("\n");
  const start = lines.findIndex((l) => l.trim() === TAKEDOWN_HEADING);
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## /.test(l));
  const section = (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
  return section ? renderLegalMarkdown(section) : null;
}

function AupList({ verdict, id }: { verdict: AupVerdict; id: string }) {
  return (
    <ul className="flex flex-col gap-3" data-testid={id}>
      {AUP_CATEGORIES.filter((c) => c.verdict === verdict).map((c) => (
        <li key={c.name} className="border-t border-mk-rule pt-3">
          <strong className="font-bold">{c.name}</strong>
          <span className="block text-mk-muted">{c.examples}</span>
        </li>
      ))}
    </ul>
  );
}

export default function HostingRulesPage() {
  const H = MK_COPY.HOSTING;
  const takedown = takedownHtml();

  return (
    <ChipField field="card" aria-labelledby="mk-hosting-h1">
      <div className={MK_READ_WRAP}>
        <ProseBlock as="article" className="flex flex-col gap-10">
          <header className="flex flex-col gap-6">
            <h1 id="mk-hosting-h1" className={MK_READ_H1}>
              {H.H1}
            </h1>
            <p>{H.LEAD}</p>
          </header>

          <section
            aria-labelledby="mk-hosting-never"
            className="flex flex-col gap-4"
          >
            <h2 id="mk-hosting-never" className={MK_READ_H2}>
              {H.NEVER_H2}
            </h2>
            <AupList verdict="never" id="mk-aup-never" />
          </section>

          <section
            aria-labelledby="mk-hosting-review"
            className="flex flex-col gap-4"
          >
            <h2 id="mk-hosting-review" className={MK_READ_H2}>
              {H.REVIEWED_H2}
            </h2>
            <AupList verdict="review" id="mk-aup-review" />
          </section>

          {takedown ? (
            <section
              aria-labelledby="mk-hosting-takedown"
              className="flex flex-col gap-4"
            >
              <h2 id="mk-hosting-takedown" className={MK_READ_H2}>
                {H.TAKEDOWN_H2}
              </h2>
              <div
                className={MK_LEGAL_HTML}
                dangerouslySetInnerHTML={{ __html: takedown }}
              />
            </section>
          ) : null}

          <p className="font-bold">
            {H.FOUND}{" "}
            <Link href="/report" className="underline underline-offset-4">
              {H.REPORT_LINK}
            </Link>
            .
          </p>
        </ProseBlock>
      </div>
    </ChipField>
  );
}

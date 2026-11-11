// Credentials block, site renderer (ADDON-08; D253, D-UI-P5-13, D-UI-P5-14; THEME-04;
// invariant 6; T-05-44; 05-UI-SPEC "Site blocks > Credentials block"). Server component: no
// hooks, no motion, --site-* tokens only. Groups arrive from server.ts blockData (expired
// removed, number only when shown); no items renders nothing at all, not even the heading.
import {
  BODY_CLASS,
  HEADING_CLASSES,
  RowRenderer,
  siteHref,
  type AddonSectionProps,
} from "@cds/ui/site";
import { ExternalLink } from "lucide-react";
import { formatMonthYear, formatYear } from "../expiry";
import type { CredentialGroupView, CredentialItemView } from "../server";
import type { CredentialsBlockContent } from "../sections/definition";

/** Groups flow in 2 columns at 1024px when there are 4 or more (D-UI-P5-13). */
export function groupsClasses(groupCount: number): string {
  return groupCount >= 4
    ? "flex flex-col gap-12 lg:block lg:columns-2 lg:gap-12"
    : "flex flex-col gap-12";
}

/** In 2 columns the flex gap is gone, so each group carries its own 48px bottom space. */
function groupClasses(groupCount: number): string {
  const base = "flex break-inside-avoid flex-col gap-4";
  return groupCount >= 4 ? `${base} lg:mb-12 lg:last:mb-0` : base;
}

/** Line 2: issuer · License no. X · Valid through March 2027 (or Since 2019). */
export function detailLine(item: CredentialItemView): string {
  const parts = [item.issuer];
  if (item.number) parts.push(`License no. ${item.number}`);
  if (item.expires_on) {
    parts.push(`Valid through ${formatMonthYear(item.expires_on)}`);
  } else if (item.issued_on) {
    parts.push(`Since ${formatYear(item.issued_on)}`);
  }
  return parts.filter((p) => p !== "").join(" · ");
}

function Item({ item }: { item: CredentialItemView }) {
  const detail = detailLine(item);
  const href = item.verify_url ? siteHref(item.verify_url) : "";
  const external = /^https?:\/\//i.test(href);
  return (
    <li className="flex flex-col gap-1 border-b border-site-border py-4 last:border-b-0">
      <span className={`${BODY_CLASS} font-semibold`}>{item.title}</span>
      {detail ? (
        <span className={`${BODY_CLASS} text-site-text-muted`}>{detail}</span>
      ) : null}
      {href && external ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Verify ${item.title} (opens in a new tab)`}
          className={`${BODY_CLASS} inline-flex w-fit items-center gap-1 text-site-primary underline underline-offset-[0.15em] hover:decoration-2`}
        >
          Verify
          <ExternalLink aria-hidden size={16} strokeWidth={2} />
        </a>
      ) : null}
    </li>
  );
}

function List({ items }: { items: CredentialItemView[] }) {
  return (
    <ul className="flex flex-col">
      {items.map((item) => (
        <Item key={item.id} item={item} />
      ))}
    </ul>
  );
}

export function CredentialsBlock({
  content,
  layout,
  background,
  isH1Owner,
  data,
}: AddonSectionProps<CredentialsBlockContent, CredentialGroupView[]>) {
  const groups = (Array.isArray(data) ? data : []).filter(
    (g) => Array.isArray(g.items) && g.items.length > 0,
  );
  if (groups.length === 0) return null;
  const heading = typeof content?.heading === "string" ? content.heading : "";
  const Heading = isH1Owner ? "h1" : "h2";
  const grouped = groups.some((g) => g.category !== "");

  return (
    <RowRenderer layout={layout} background={background}>
      <div className="flex max-w-[800px] flex-col gap-8">
        {heading.trim() !== "" ? (
          <Heading
            className={`${HEADING_CLASSES[isH1Owner ? 1 : 2]} text-balance`}
          >
            {heading}
          </Heading>
        ) : null}
        {grouped ? (
          <div className={groupsClasses(groups.length)}>
            {groups.map((g) => (
              <div key={g.category} className={groupClasses(groups.length)}>
                <h3 className={HEADING_CLASSES[3]}>{g.category}</h3>
                <List items={g.items} />
              </div>
            ))}
          </div>
        ) : (
          <List items={groups.flatMap((g) => g.items)} />
        )}
      </div>
    </RowRenderer>
  );
}

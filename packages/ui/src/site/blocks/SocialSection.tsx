// SocialSection (07-24; CONT-27, D198; 07-UI-SPEC "Social and sharing"; T-07-24-01, -03).
//
// Social links come live from coreData.business.socials (07-07; readBusiness keeps only
// http(s) urls of known platforms). Each is a 44px icon link: a vendored Simple Icons path
// in currentColor (D-UI-P7-6), text -> primary on hover, named "<Business> on <Platform>".
// `other` uses lucide Globe. The share row is the ShareButtons island (plain share URLs, no
// SDKs). Nothing renders when there are no links to show and share is off. The heading is
// an <h2> only when non-blank. --site-* roles only. Server component.
import { socialLinkLabel, type SocialBlockContent } from "@cds/core/content";
import { Globe } from "lucide-react";
import { ShareButtons } from "../client/ShareButtons";
import { BrandIcon } from "../icons/BrandIcon";
import { brandForPlatform } from "../icons/brands";
import { RowRenderer } from "../RowRenderer";
import { HEADING_CLASSES, type SectionComponentProps } from "../types";
import { text } from "../urls";
import { readBusiness } from "./business";

export function SocialSection({
  content,
  layout,
  background,
  coreData,
}: SectionComponentProps<SocialBlockContent>) {
  const c = (content ?? {}) as SocialBlockContent;
  const business = readBusiness(coreData);
  const links = c.show_socials !== false && business ? business.socials : [];
  const targets = Array.isArray(c.share) ? c.share : [];
  const showShare = c.show_share === true && targets.length > 0;
  if (links.length === 0 && !showShare) return null;
  const heading = text(c.heading);

  return (
    <RowRenderer layout={layout} background={background}>
      <div className="flex flex-col gap-6">
        {heading && <h2 className={HEADING_CLASSES[2]}>{heading}</h2>}
        {links.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {links.map((link, i) => {
              const brand = brandForPlatform(link.platform);
              return (
                <li key={`${link.platform}-${i}`}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="me noopener noreferrer"
                    aria-label={socialLinkLabel(business!.name, link)}
                    className="inline-flex size-11 items-center justify-center rounded-site-button text-site-text transition-colors duration-150 hover:text-site-primary"
                  >
                    {brand ? (
                      <BrandIcon id={brand} size={24} />
                    ) : (
                      <Globe size={24} aria-hidden="true" focusable="false" />
                    )}
                  </a>
                </li>
              );
            })}
          </ul>
        ) : null}
        {showShare ? (
          <ShareButtons targets={targets} share={coreData?.share ?? null} />
        ) : null}
      </div>
    </RowRenderer>
  );
}

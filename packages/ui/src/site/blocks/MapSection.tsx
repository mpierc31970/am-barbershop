// MapSection (07-24; CONT-24, D230, D279, D281; 07-UI-SPEC "Map" + Consent; T-07-24-02/-03).
//
// The place query is the block's own location (a parsed address or Maps link), else the
// business address from coreData.business (live, D253). No address anywhere renders
// nothing. The map goes through ConsentFrame as { kind: "map", query, key? }: the frame URL
// is built only in the browser after consent (07-14 relay, core mapFrameUrl), never here.
// The browser key arrives as data (coreData.mapKey). Get directions sits outside the frame
// and always works (a plain Google Maps link, no key, no script). The heading is an <h2>
// only when non-blank. --site-* roles only. Server component.
import {
  mapAddressQuery,
  mapDirectionsUrl,
  type MapBlockContent,
} from "@cds/core/content";
import { ExternalLink } from "lucide-react";
import { ConsentFrame } from "../ConsentFrame";
import { RowRenderer } from "../RowRenderer";
import {
  BODY_CLASS,
  HEADING_CLASSES,
  type SectionComponentProps,
} from "../types";
import { text } from "../urls";
import { readBusiness } from "./business";

export function MapSection({
  content,
  layout,
  background,
  coreData,
}: SectionComponentProps<MapBlockContent>) {
  const c = (content ?? {}) as MapBlockContent;
  const own = text(c.location);
  const business = readBusiness(coreData);
  const query = own || (business ? mapAddressQuery(business.address) : "");
  if (query === "") return null;
  const heading = text(c.heading);
  const directions = c.show_directions !== false ? mapDirectionsUrl(query) : "";
  const key = typeof coreData?.mapKey === "string" ? coreData.mapKey : "";

  return (
    <RowRenderer layout={layout} background={background}>
      <div className="flex flex-col gap-4">
        {heading && <h2 className={HEADING_CLASSES[2]}>{heading}</h2>}
        <ConsentFrame
          source={{ kind: "map", query, ...(key ? { key } : {}) }}
          kind="map"
          title={heading || "Map"}
          address={query}
        />
        <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
          <p className={`${BODY_CLASS} text-site-text`}>{query}</p>
          {directions ? (
            <a
              href={directions}
              target="_blank"
              rel="noopener noreferrer"
              className={`${BODY_CLASS} inline-flex min-h-11 items-center gap-2 font-semibold text-site-primary underline-offset-4 hover:underline`}
            >
              Get directions
              <span className="sr-only"> (opens Google Maps in a new tab)</span>
              <ExternalLink size={20} aria-hidden="true" focusable="false" />
            </a>
          ) : null}
        </div>
      </div>
    </RowRenderer>
  );
}

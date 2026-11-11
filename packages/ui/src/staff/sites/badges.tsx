// Site state and flag badges (13-33; 13-UI-SPEC tone map lines 190-221). Server-safe: the
// Sites list, the site detail header and the Overview share them. Every badge carries its word.
import { Badge } from "../../hub/Badge";
import { SITE_STATE_BADGE, SITES_COPY as C, type SiteStateView } from "./copy";

export function SiteStateBadge({ state }: { state: SiteStateView }) {
  const b = SITE_STATE_BADGE[state];
  return <Badge tone={b.tone}>{b.label}</Badge>;
}

export function SiteFlags({
  demo,
  repeatInfringer,
}: {
  demo: boolean;
  repeatInfringer: boolean;
}) {
  if (!demo && !repeatInfringer) return null;
  return (
    <>
      {demo ? <Badge tone="demo">{C.demo}</Badge> : null}
      {repeatInfringer ? (
        <span title={C.repeatTitle}>
          <Badge tone="repeat">{C.repeat}</Badge>
        </span>
      ) : null}
    </>
  );
}

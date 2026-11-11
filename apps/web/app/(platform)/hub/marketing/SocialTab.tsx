// Marketing › Social (11-37; DASH-14, DASH-15, DASH-16; D198-D200; 11-UI-SPEC "Marketing ›
// Social" lines 803-846; T-11-37-01). Server panel: reads the site's accounts and the Grow
// ticks (content read: every member role), then hands plain props and the server actions to
// the client SocialPanel. Editing (add, edit, reorder, remove, ticks) is offered to settings
// writers (Owner, Admin; UI-SPEC, 11-50); @cds/db enforces it again on every write. Bio links use the
// org's primary host (the preview address until P14 moves the site to its own domain, when
// BIO-PREVIEW shows). CDS never posts for the tenant and shows no follower counts (D199).
import { can } from "@cds/core";
import { listSocialAccounts, previewHostSuffix, readGrowTicks } from "@cds/db";
import { SocialPanel } from "@cds/ui/hub/social";
import type { JSX } from "react";
import type { HubSession } from "../../../../lib/session";
import {
  addSocialAccountAction,
  removeSocialAccountAction,
  reorderSocialAccountsAction,
  restoreSocialAccountAction,
  setGrowTickAction,
  updateSocialAccountAction,
} from "../../../actions/social";

/** True while the site is still on its CDS preview address (no own domain yet). */
export function onPreviewHost(host: string | null): boolean {
  if (!host) return true;
  const suffix = previewHostSuffix();
  return host === suffix || host.endsWith(`.${suffix}`);
}

export async function SocialTab(session: HubSession): Promise<JSX.Element> {
  const { ctx, org } = session;
  const [accounts, grow] = await Promise.all([
    listSocialAccounts(ctx),
    readGrowTicks(ctx),
  ]);
  const host = org.primaryHost;
  return (
    <SocialPanel
      accounts={accounts}
      origin={host ? `https://${host}` : null}
      preview={onPreviewHost(host)}
      canEdit={can(ctx, "settings", "write")}
      actions={{
        add: addSocialAccountAction,
        update: updateSocialAccountAction,
        remove: removeSocialAccountAction,
        restore: restoreSocialAccountAction,
        reorder: reorderSocialAccountsAction,
      }}
      grow={{
        category: grow.category,
        ticks: grow.ticks,
        onToggle: setGrowTickAction,
      }}
    />
  );
}

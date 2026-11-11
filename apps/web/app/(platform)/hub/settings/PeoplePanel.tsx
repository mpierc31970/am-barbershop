// Settings › People & roles (11-39; DASH-22, DASH-25, DASH-27; D285, D311; 11-UI-SPEC lines
// 847-873). Server panel: reads people, pending invites and the active add-ons (the access
// choices) through the chokepoint (members:read: Owner and Admin), then hands plain props
// and the server actions to the client PeopleTable. The Owner manages; an Admin and CDS
// staff impersonating the Owner read only (the actions and @cds/db refuse them too).
import { getBusinessProfile } from "@cds/db";
import { PeopleTable, type PeopleViewer } from "@cds/ui/hub/people";
import type { JSX } from "react";
import {
  addonAccessOptions,
  loadPeopleLists,
} from "../../../../lib/people-view";
import type { HubSession } from "../../../../lib/session";
import {
  changeRoleAction,
  inviteMemberAction,
  removePersonAction,
  resendInviteAction,
  revokeInviteAction,
  setGrantsAction,
} from "../../../actions/people";

type Ctx = HubSession["ctx"];

export function peopleViewer(ctx: Ctx): PeopleViewer {
  if (ctx.impersonator) return "impersonating";
  return ctx.role === "owner" ? "owner" : "admin";
}

export async function peoplePanel(ctx: Ctx): Promise<JSX.Element> {
  const [lists, addons, orgName] = await Promise.all([
    loadPeopleLists(ctx),
    // An add-on read outage only hides the access choices; the table still loads.
    addonAccessOptions(ctx).catch((err: unknown) => {
      console.error(
        "[hub] settings people: active add-ons failed",
        err instanceof Error ? err.name : typeof err,
      );
      return [];
    }),
    getBusinessProfile(ctx)
      .then((p) => p.orgName)
      .catch(() => "this site"),
  ]);
  return (
    <PeopleTable
      people={lists.people}
      invites={lists.invites}
      addons={addons}
      orgName={orgName || "this site"}
      viewer={peopleViewer(ctx)}
      actions={{
        invite: inviteMemberAction,
        resend: resendInviteAction,
        revoke: revokeInviteAction,
        changeRole: changeRoleAction,
        setGrants: setGrantsAction,
        remove: removePersonAction,
      }}
    />
  );
}

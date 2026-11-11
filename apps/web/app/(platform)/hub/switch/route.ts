// /hub/switch?org=<id>&next=<hub href>: open a hub link in a named site (review 11 WR-C01).
// A push notification is raised by one org, but the hub reads the org from the cds_org cookie
// (whatever site the person last chose), so the service worker opens its link through here.
// The org is untrusted: it is honoured only when it is one of the person's own memberships
// (the same rule as switchOrgAction, T-11-11-01); anything else lands on Today without
// switching. `next` must pass isHubHref (open-redirect guard, T-11-04-01). Signed out, the
// link opens as is and the hub sends the person to sign in.
import { CdsError } from "@cds/core";
import { isHubHref } from "@cds/core/today";
import { listMemberOrganizations } from "@cds/db";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { withFlash } from "../../../../lib/flash";
import {
  orgCookieName,
  sessionCookieName,
  setOrgCookie,
} from "../../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORG_ID_RE = /^[a-z0-9]{15}$/;
const FALLBACK = "/hub/today";

async function isMember(token: string, orgId: string): Promise<boolean> {
  try {
    const linked = await listMemberOrganizations(token);
    return linked.organizations.some((o) => o.id === orgId);
  } catch (err) {
    if (!(err instanceof CdsError)) {
      console.error(
        "[hub-switch] membership lookup failed",
        err instanceof Error ? err.name : typeof err,
      );
    }
    return false;
  }
}

export async function GET(req: Request): Promise<never> {
  const params = new URL(req.url).searchParams;
  const rawNext = params.get("next") ?? "";
  const next = isHubHref(rawNext) ? rawNext : FALLBACK;
  const org = params.get("org") ?? "";
  const jar = await cookies();
  const token = jar.get(sessionCookieName())?.value;
  if (!token) redirect(next);
  if (!ORG_ID_RE.test(org) || !(await isMember(token, org))) redirect(FALLBACK);
  if (jar.get(orgCookieName())?.value === org) redirect(next);
  await setOrgCookie(org);
  revalidatePath("/hub", "layout");
  // 11-50: the switched toast names the site, so the person sees which one opened.
  redirect(next.includes("#") ? next : withFlash(next, "switched"));
}

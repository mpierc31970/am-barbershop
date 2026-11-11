// P8 (08-08): builder business data, 07-24 + Services count line (UI-SPEC) and Contact
// preset email (D-UI-P8-8). Moved out of the builder page so it is unit-testable.
//
// Read with the hub session's OrgContext and passed to the client as a plain BuilderBusiness:
// name, phone, formatted address, has-hours, socials and business type (07-24), plus the
// count of published services and the public business email (T-07-24-07, T-08-08-05: both
// already public; no private fields). Forbidden or a profile failure means none (null). The
// services count is read alongside the profile; its failure only leaves the count out.
import { CdsError } from "@cds/core";
import { mapAddressQuery } from "@cds/core/content";
import { DAYS } from "@cds/core/intake";
import { getBusinessProfile, listServices, type OrgContext } from "@cds/db";
import type { BuilderBusiness } from "@cds/ui/builder";

/** The published-services count, or undefined when the read fails (never breaks the builder). */
async function publishedServicesCount(
  ctx: OrgContext,
): Promise<number | undefined> {
  try {
    return (await listServices(ctx)).filter((s) => s.is_published === true)
      .length;
  } catch (err) {
    if (!(err instanceof CdsError && err.code === "forbidden")) {
      console.error("[hub] builder services count failed", err);
    }
    return undefined;
  }
}

/** The builder's business details; Forbidden or a failure means none (07-24). */
export async function builderBusiness(
  ctx: OrgContext,
): Promise<BuilderBusiness | null> {
  try {
    const [p, publishedServices] = await Promise.all([
      getBusinessProfile(ctx),
      publishedServicesCount(ctx),
    ]);
    const hours = p.hours;
    const email =
      typeof p.public_email === "string" ? p.public_email.trim() : "";
    return {
      name: p.orgName,
      phone: p.phone,
      addressText: mapAddressQuery(p.address),
      hasHours:
        hours !== null &&
        DAYS.some((d) => hours[d]?.open === true && hours[d].ranges.length > 0),
      socials: p.socials.map((s) => ({ platform: s.platform, url: s.url })),
      businessType: p.business_type,
      ...(publishedServices !== undefined ? { publishedServices } : {}),
      ...(email !== "" ? { email } : {}),
    };
  } catch (err) {
    if (!(err instanceof CdsError && err.code === "forbidden")) {
      console.error("[hub] builder business load failed", err);
    }
    return null;
  }
}

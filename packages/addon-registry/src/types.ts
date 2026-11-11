// Module contracts for the server and admin entry points (ADDON-02; RESEARCH Pattern 2).
// Types only. No @cds/ui/site import: server.ts is type-checked from @cds/db scripts and
// tests, whose tsconfig does not compile .tsx (the site types live in site.ts).
import type { ComponentType } from "react";
import type { NeedsYouItem, TodayCardData } from "@cds/core/today";
import type { addonRepo } from "@cds/db";

/**
 * 11-08: the org context add-on server code already receives (the add-on repo.ts pattern,
 * `Parameters<typeof addonRepo>[0]`). Type only: a branded OrgContext minted by @cds/db and
 * passed in as a parameter (invariant 4), never read from global state.
 */
export type OrgContextLike = Parameters<typeof addonRepo>[0];

/**
 * 11-08 (DASH-21): the optional `today` named export of an add-on's server entry. `card` backs
 * the manifest's `today.card` (null = nothing to show today); `needsYou` backs
 * `today.needsYou: true`. Each reads only the add-on's own collections through its repo.
 */
export type AddonServerToday = {
  card?: (ctx: OrgContextLike) => Promise<TodayCardData | null>;
  needsYou?: (ctx: OrgContextLike) => Promise<NeedsYouItem[]>;
};

export type AddonSectionRef = {
  id: string;
  section_type: string;
  content: Record<string, unknown>;
};

export type AddonRecordLike = { id: string } & Record<string, unknown>;

/**
 * "./server": pure data transforms. The platform fetches `blockCollections` records through
 * the cached, org-scoped chokepoint read and passes them in (05-10), so add-on server code
 * never touches a context, env or a client.
 */
export type AddonServerModule = {
  blockCollections: readonly string[];
  blockData(
    sections: readonly AddonSectionRef[],
    records: Readonly<Record<string, readonly AddonRecordLike[]>>,
    now: Date,
  ): Record<string, unknown>;
  /** 11-08: Today card and Needs-you providers (reached through activeTodayProviders only). */
  today?: AddonServerToday;
};

/* eslint-disable @typescript-eslint/no-explicit-any -- forms are typed per add-on */
/** "./admin": the nav tab panel and one block form per section type (client modules). */
export type AddonAdminModule = {
  Panel: ComponentType<any>;
  blockForms: Readonly<Record<string, ComponentType<any>>>;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

// Staff Today counts for one request (13-47 choices 1, 4). The layout (sidebar badges) and the
// Today page read the same staffTodayCounts call: React cache() keys it on the per-request
// staff session (getStaffSession is itself cached), so /staff fans out once, not twice.
// Server-only. The add-on manifests come from the registry here (Invariant 4, P13-P7).
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { staffTodayCounts, type StaffTodayCounts } from "@cds/db";
import { cache } from "react";
import type { StaffWebSession } from "./staff-session";

export const loadStaffToday = cache(
  async (session: StaffWebSession): Promise<StaffTodayCounts> =>
    staffTodayCounts(session.ctx, { manifests: ADDON_REGISTRY.list() }),
);

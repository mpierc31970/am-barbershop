// Uninstall disables and retains (invariant 9). Adding it back restores every seat.
import type { UninstallPolicy } from "@cds/core/addons";

export const UNINSTALL = { retain: "all" } as const satisfies UninstallPolicy;

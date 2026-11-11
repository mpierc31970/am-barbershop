// Uninstall disables and retains (invariant 9, ADDON-05). Adding it back restores.
import type { UninstallPolicy } from "@cds/core/addons";

export const UNINSTALL = { retain: "all" } as const satisfies UninstallPolicy;

// Install recipe (invariant 3): installing seeds nothing. Seats are added by the owner in the
// hub (or by the shop seed, `npm run am:studio-seed`).
import type { InstallRecipe } from "@cds/core/addons";

export const INSTALL = {} satisfies InstallRecipe;

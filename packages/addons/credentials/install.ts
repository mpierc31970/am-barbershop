// Install recipe (ADDON-04; D183; invariant 3). Installing is never a migration: it seeds a
// published /credentials page with one Credentials block and names the collection that
// intake records (P8) seed into.
import type { InstallRecipe } from "@cds/core/addons";
import { defaultCredentialsContent } from "./sections/definition";

export const INSTALL = {
  page: {
    slug: "credentials",
    title: "Credentials",
    sections: [
      { section_type: "credentials", content: defaultCredentialsContent() },
    ],
  },
  records: { collection: "credentials" },
} satisfies InstallRecipe;

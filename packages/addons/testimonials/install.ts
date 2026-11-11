// Install recipe (ADDON-04; D183; invariant 3). Installing is never a migration: it seeds a
// published /testimonials page with one Testimonials block and names the collection that
// intake records (P8) seed into.
import type { InstallRecipe } from "@cds/core/addons";
import { defaultTestimonialsContent } from "./sections/definition";

export const INSTALL = {
  page: {
    slug: "testimonials",
    title: "Testimonials",
    sections: [
      { section_type: "testimonials", content: defaultTestimonialsContent() },
    ],
  },
  records: { collection: "testimonials" },
} satisfies InstallRecipe;

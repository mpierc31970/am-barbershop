// Add-ons share image (15-23; HUB-01, D-UI-P15-28, P15-P24). Static: rendered at build.
// /add-ons/[slug] has none of its own (dynamic); it inherits this one.
import { MK_COPY } from "@cds/core/marketing";
import { OG_SIZE, ogImage } from "../../../../lib/og-image";

export const alt = MK_COPY.SEO.ADDONS_TITLE;
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return ogImage({ title: MK_COPY.ADDONS.H1, chip: "marigold" });
}

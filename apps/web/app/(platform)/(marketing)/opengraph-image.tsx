// Home share image (15-23; HUB-01, D-UI-P15-28, P15-P24). Static: rendered at build.
import { MK_COPY } from "@cds/core/marketing";
import { OG_SIZE, ogImage } from "../../../lib/og-image";

export const alt = MK_COPY.SEO.HOME_TITLE;
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return ogImage({ title: MK_COPY.HOME.H1, chip: "ink" });
}

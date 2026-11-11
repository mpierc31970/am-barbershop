// EmbedItem: the public render of a booking calendar column item (07-08 seam, filled by
// 07-23; CONT-27, CONT-34, D-UI-P7-35). Calendly or a public Google Calendar, only through
// 07-14's ConsentFrame, which applies the fixed provider height. Server component.
import type { EmbedColumnItem } from "@cds/core/content";
import { ConsentFrame } from "../ConsentFrame";
import { text } from "../urls";
import type { ItemComponentProps } from "./types";
import { embedView } from "./video-logic";

export function EmbedItem({ item }: ItemComponentProps<EmbedColumnItem>) {
  const view = embedView(item);
  if (!view) return null;
  return (
    <ConsentFrame
      source={{ kind: "link", provider: view.provider, id: view.id }}
      kind="booking"
      title={text(item.title)}
    />
  );
}

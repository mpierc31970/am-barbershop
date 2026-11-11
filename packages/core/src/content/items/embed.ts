// Curated embed ("Booking calendar") column item validator (07-08; CONT-27, D281).
//
// Pure and Edge-safe, no sanitizer. Only the embed allowlist (Calendly, public Google
// Calendar) is accepted; there is no raw embed HTML anywhere (CONT-32). Never stores a URL.
import { InvalidInput } from "../../errors";
import {
  EMBED_LINK_EMPTY_COPY,
  EMBED_NOT_ALLOWED_COPY,
  type EmbedProvider,
} from "../media-link";
import type { EmbedColumnItem } from "../types";
import type { Raw } from "../validate-helpers";
import { itemLink, requiredTitle } from "./shared";

export const EMBED_TITLE_COPY = 'Add a title, like "Book a consultation".';

export function validateEmbedItem(raw: Raw, id: string): EmbedColumnItem {
  const title = requiredTitle(raw, EMBED_TITLE_COPY);
  const link = itemLink(raw, "embed", EMBED_NOT_ALLOWED_COPY);
  if (!link) throw new InvalidInput(EMBED_LINK_EMPTY_COPY);
  return {
    id,
    kind: "embed",
    title,
    provider: link.provider as EmbedProvider,
    provider_id: link.id,
  };
}

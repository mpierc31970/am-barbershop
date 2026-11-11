// Owner: 15-06 (P15-P1). Work and proof entries (confirmed flag, P15-P15, CONTEXT A1-Q6).
// Facts from 15-PARITY-INVENTORY.md "Facts" only. Every entry starts unconfirmed: production shows
// confirmed entries only, dev shows all (with DraftBadge). The user confirms each one (HUMAN-CHECKS,
// 15-29) by flipping `confirmed`. Never add an entry the archive or the user did not state.

import type { MkPathKey } from "./paths";

export type WorkSite = {
  readonly name: string;
  readonly url: string;
  readonly path: MkPathKey;
  readonly outcome: string;
  readonly confirmed: boolean;
};

export type Testimonial = {
  readonly quote: string;
  readonly name: string;
  readonly business: string;
  readonly confirmed: boolean;
};

export type AboutFact = {
  readonly label: string;
  readonly value: string;
  readonly confirmed: boolean;
};

export const WORK_SITES: readonly WorkSite[] = Object.freeze([
  {
    name: "Palm Science",
    url: "https://palm-science.com",
    path: "standard",
    outcome: "Palmistry and life-path coaching",
    confirmed: false,
  },
  {
    name: "Spiritual Empowerments",
    url: "https://spiritualempowerments.com",
    path: "standard",
    outcome: "Tarot and intuitive readings",
    confirmed: false,
  },
  {
    name: "Metaphysical Events",
    url: "https://metaphysicalevents.com",
    path: "standard",
    outcome: "Community platform and marketplace",
    confirmed: false,
  },
]);

/** The archive published no testimonials; the section hides while this is empty. */
export const TESTIMONIALS: readonly Testimonial[] = Object.freeze([]);

export const ABOUT_FACTS: readonly AboutFact[] = Object.freeze([
  {
    label: "Business name",
    value: "Connections Design Studios",
    confirmed: false,
  },
  { label: "Service area", value: "DFW + remote", confirmed: false },
  {
    label: "Email",
    value: "info@connectionsdesignstudios.com",
    confirmed: false,
  },
  { label: "Phone", value: "817-213-6223", confirmed: false },
]);

/** Production shows confirmed entries only; dev and preview show every entry. */
export function visibleProof<T extends { readonly confirmed: boolean }>(
  list: readonly T[],
  production: boolean,
): readonly T[] {
  return production ? list.filter((entry) => entry.confirmed) : list;
}

// Owner-facing page and section shapes the page builder's client components receive (BILL-05,
// 10-18). Defined here, not in @cds/db, so "use client" modules type their props without
// importing the db layer; @cds/db re-exports them unchanged.
import type { PageSeo } from "./types";

export type PageSummary = {
  id: string;
  slug: string;
  title: string;
  status: "draft" | "published" | "held";
  published_at: string | null;
  has_unpublished_changes: boolean;
  kind: "builder" | "system-404";
  /** isProtected: flag or stored hash (fail closed); the hash itself is never returned. */
  password_protected: boolean;
  seo: PageSeo;
  previous_slugs: string[];
};

export type SectionRow = {
  id: string;
  page: string;
  section_type: string;
  row_layout: string;
  content: unknown;
  settings: { background_variant: "main" | "alternate" };
  sort_order: number;
  is_published: boolean;
};

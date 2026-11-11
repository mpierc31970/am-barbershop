// SearchResultPreview: how a page looks in search results (07-30; CONT-14, D188; 07-UI-SPEC
// "SEO & sharing drawer" section 1). On --hub-surface-2 with 16px padding: the title (Body 600,
// one line, cut at 60 characters as Google would), the address "host › path" (Label
// ink-muted) and the description (Body, two lines). React text only.
import { SEO_LIMITS } from "@cds/core/seo";

export interface SearchResultPreviewProps {
  title: string;
  host: string;
  /** The page path without the leading slash ("" for home). */
  path: string;
  description: string;
}

/** Cut at the limit with an ellipsis, as search results do. */
export function ellipsize(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export function SearchResultPreview({
  title,
  host,
  path,
  description,
}: SearchResultPreviewProps) {
  const address = path ? `${host} › ${path}` : host;
  return (
    <div
      className="flex flex-col gap-1 rounded bg-hub-surface-2 p-4 font-hub"
      data-search-preview=""
    >
      <span className="truncate text-sm text-hub-ink-muted">{address}</span>
      <span className="truncate text-base font-semibold text-hub-ink">
        {ellipsize(title, SEO_LIMITS.title)}
      </span>
      <span className="line-clamp-2 text-base text-hub-ink">{description}</span>
    </div>
  );
}

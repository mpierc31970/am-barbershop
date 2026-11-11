// Hub TabLinks (03-UI-SPEC "Hub shell" Website page; D311 DCR-Website admin pattern, donor
// SiteContent.tsx tabs from one array). Each tab is a real link (`?tab=`), so tabs are
// shareable, work without JS and keep browser history. The active tab carries
// aria-current="page" and a 2px accent underline. Min height 48px; on narrow screens the
// tabs wrap onto a second line (A&M fork: never a sideways scroll). Server-safe. Pass
// `LinkComponent` (next/link) from the app for client-side navigation; the default is <a>.
import type { AnchorHTMLAttributes, ComponentType } from "react";

export interface TabLink {
  id: string;
  label: string;
  href: string;
}

export interface TabLinksProps {
  tabs: readonly TabLink[];
  activeId: string;
  /** Accessible name of the tab bar. */
  label?: string;
  LinkComponent?: ComponentType<
    AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }
  >;
}

export function TabLinks({
  tabs,
  activeId,
  label = "Sections",
  LinkComponent,
}: TabLinksProps) {
  const Link = LinkComponent ?? "a";
  return (
    <nav aria-label={label} className="border-b border-hub-border font-hub">
      <ul className="flex flex-wrap gap-x-2">
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          return (
            <li key={tab.id}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={
                  "-mb-px inline-flex min-h-12 items-center border-b-2 px-4 text-base " +
                  "transition-colors duration-150 " +
                  (active
                    ? "border-hub-accent font-semibold text-hub-ink"
                    : "border-transparent text-hub-ink-muted hover:bg-hub-surface-2 hover:text-hub-ink")
                }
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

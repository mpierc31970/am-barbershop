// CDS Support frame (12-19 choice 2; COMM-05, COMM-07, D83, D311; 12-UI-SPEC "Support frame"
// lines 247-270, responsive lines 859-867). Server component wrapped around every tab:
//   - Root carries data-cds-identity: the whole screen is a CDS identity surface (neutral-chrome
//     allowlist, 12-06), 880px column.
//   - ScreenHeader: CdsMark 32 + H1 "CDS Support" + "?" (12-33: the active tab's own P12
//     article from its SectionTab.helpId, "support" when there are no tabs) and the
//     primary Get help -> /hub/support/tickets/new?from=<current url>. < 640px Get help drops
//     under the byline, full width (two renders, one hidden per width).
//   - Viewers (no support:write) and impersonating staff get no Get help: Viewers read the
//     VIEWER-READONLY Label, staff an info InlineAlert IMPERSONATING-SUPPORT.
//   - Byline "From the Connections Design Studios team · What support includes" (link to the
//     SUPPORT-01 help article, docs/how-to/what-support-includes.md, 12-33).
//   - TabLinks Messages · Tickets · Documents · Ideas from HUB_SECTIONS.support.tabs.
//   - Footer on every tab: SUPPORT-EMAIL-FALLBACK with the address as a mailto (kept from the
//     interim page: "Help with {Business}" subject, site id in the body).
import { buttonClasses, InlineAlert, TabLinks } from "@cds/ui/hub";
import { CdsMark } from "@cds/ui/hub/cds";
import { ScreenHeader } from "@cds/ui/hub/shell";
import { SUPPORT_UI_COPY } from "@cds/ui/hub/support";
import type { ReactNode } from "react";
import { GuardedLink } from "../GuardedLink";
import type { SectionTab } from "../sections";
import {
  SUPPORT_COPY,
  WHAT_SUPPORT_INCLUDES_HREF,
  getHelpHref,
  supportMailto,
} from "./support-copy";

export type SupportAccess = "write" | "viewer" | "impersonating";

export interface SupportFrameProps {
  activeTab: string;
  tabs: readonly SectionTab[];
  access: SupportAccess;
  /** Support address (CDS_SUPPORT_EMAIL or the dev default). */
  address: string;
  business: string;
  orgId: string;
  /** The current hub URL, carried to the new-ticket form as `from`. */
  from: string;
  children: ReactNode;
}

const LINK =
  "rounded text-hub-accent underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

export function SupportFrame({
  activeTab,
  tabs,
  access,
  address,
  business,
  orgId,
  from,
  children,
}: SupportFrameProps) {
  const helpHref = getHelpHref(from);
  const canWrite = access === "write";
  const helpId = tabs.find((t) => t.id === activeTab)?.helpId ?? "support";
  return (
    <div
      className="flex w-full max-w-[880px] flex-col gap-6 font-hub text-hub-ink"
      data-cds-identity=""
      data-support-screen=""
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <CdsMark size={32} />
          <div className="min-w-0 flex-1">
            <ScreenHeader
              title={SUPPORT_COPY.title}
              helpId={helpId}
              LinkComponent={GuardedLink}
            >
              {canWrite ? (
                <GuardedLink
                  href={helpHref}
                  className={`${buttonClasses("primary")} hidden sm:inline-flex`}
                  data-support-get-help=""
                >
                  {SUPPORT_UI_COPY.BUTTONS.getHelp}
                </GuardedLink>
              ) : null}
            </ScreenHeader>
          </div>
        </div>
        <p className="text-sm text-hub-ink-muted">
          {SUPPORT_UI_COPY.BYLINE}
          {" · "}
          <GuardedLink
            href={WHAT_SUPPORT_INCLUDES_HREF}
            className={LINK}
            data-support-includes=""
          >
            {SUPPORT_UI_COPY.BUTTONS.whatSupportIncludes}
          </GuardedLink>
        </p>
        {canWrite ? (
          <GuardedLink
            href={helpHref}
            className={`${buttonClasses("primary")} w-full justify-center sm:hidden`}
            data-support-get-help-narrow=""
          >
            {SUPPORT_UI_COPY.BUTTONS.getHelp}
          </GuardedLink>
        ) : null}
        {access === "viewer" ? (
          <p
            className="text-sm text-hub-ink-muted"
            data-support-role-line="viewer"
          >
            {SUPPORT_UI_COPY.VIEWER_READONLY}
          </p>
        ) : null}
        {access === "impersonating" ? (
          <div data-support-role-line="impersonating">
            <InlineAlert tone="info">
              {SUPPORT_UI_COPY.IMPERSONATING_SUPPORT}
            </InlineAlert>
          </div>
        ) : null}
      </div>
      <TabLinks
        label={SUPPORT_COPY.tabsLabel}
        activeId={activeTab}
        tabs={tabs.map((t) => ({
          id: t.id,
          label: t.count ? `${t.label} · ${t.count}` : t.label,
          href: t.href,
        }))}
        LinkComponent={GuardedLink}
      />
      <div key={activeTab} data-support-tab={activeTab}>
        {children}
      </div>
      <footer
        className="mt-2 border-t border-hub-border pt-4 text-sm text-hub-ink-muted"
        data-support-footer=""
      >
        {(() => {
          const text = SUPPORT_UI_COPY.SUPPORT_EMAIL_FALLBACK(address);
          const at = text.indexOf(address);
          return (
            <p>
              {text.slice(0, at)}
              <a
                href={supportMailto(address, business, orgId)}
                className={LINK}
                data-support-email=""
              >
                {address}
              </a>
              {text.slice(at + address.length)}
            </p>
          );
        })()}
      </footer>
    </div>
  );
}

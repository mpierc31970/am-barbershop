// Website › Footer tab (CONT-13; D249, D311, D253; 07-UI-SPEC "Site chrome editors" /
// "Footer"; owner 07-25, 07-29 adds History). Server-loads the footer settings, pages,
// theme and the business details the preview shows (address, hours, socials), and hands
// them to the client FooterForm. The business read is optional: a failure (or a role that
// can't read it) previews with the org name only.
// 12-17 (COMM-11, D102): EditorLockFrame shows the LockedPanel (footer or org window) or the
// HeldChangesPanel above the form and disables the form while either applies; a locked save
// is parked as a held draft by saveFooterAction. Keyed by editorLockKey (fresh form state).
import {
  FOOTER_COPY,
  type FooterBusinessInput,
  type FooterSettings,
} from "@cds/core/content";
import { resolveTheme } from "@cds/core/theme";
import {
  getBusinessProfile,
  getFooter,
  listPages,
  readOrganizationDesign,
  type PageSummary,
} from "@cds/db";
import { loadEditorLock } from "../../../../lib/editor-lock";
import { editorLockKey } from "../../../../lib/editor-lock-shared";
import { EditorLockFrame } from "./EditorLock";
import { requireHubSession } from "../../../../lib/session";
import { themeOrNeutral } from "../../../../lib/theme-read";
import { FooterForm } from "./FooterForm";
import { ChromeLoadError, chromePages } from "./NavigationTab";

async function footerBusiness(
  ctx: Parameters<typeof getBusinessProfile>[0],
  orgName: string,
): Promise<FooterBusinessInput> {
  try {
    const p = await getBusinessProfile(ctx);
    return {
      name: p.orgName || orgName,
      phone: p.phone,
      public_email: p.public_email,
      address: p.address,
      time_zone: p.time_zone,
      hours: p.hours,
      socials: p.socials,
    };
  } catch {
    return {
      name: orgName,
      phone: "",
      public_email: "",
      address: null,
      time_zone: "",
      hours: null,
      socials: [],
    };
  }
}

export async function FooterTab(): Promise<React.JSX.Element> {
  const { ctx, org } = await requireHubSession();
  let footer: FooterSettings | null;
  let pages: PageSummary[];
  let design: unknown;
  let business: FooterBusinessInput;
  const lockRead = loadEditorLock(ctx, { kind: "part", key: "footer" });
  try {
    [footer, pages, design, business] = await Promise.all([
      getFooter(ctx),
      listPages(ctx),
      themeOrNeutral(readOrganizationDesign(ctx), "hub"),
      footerBusiness(ctx, org.name),
    ]);
  } catch (err) {
    console.error("[hub] footer load failed", err);
    return <ChromeLoadError tab="footer" />;
  }
  const lock = await lockRead;
  return (
    <EditorLockFrame
      key={editorLockKey(lock)}
      state={lock}
      target="footer"
      panelId="footer-lock"
      heldCopy={FOOTER_COPY.held}
    >
      <FooterForm
        initial={footer}
        pages={chromePages(pages)}
        theme={resolveTheme(design)}
        business={business}
      />
    </EditorLockFrame>
  );
}

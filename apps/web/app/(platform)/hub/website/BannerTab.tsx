// Website › Banner tab (CONT-11, D117, D123; 03-UI-SPEC "Banner tab"). Server-loads the
// org's banner settings for the signed-in member and hands them to the client form. The
// org comes only from the session cookie. The org's theme is resolved here too and passed
// down as precomputed { hash, css } so the live preview shows the real fonts and colours
// with no client fetch (THEME-02; 04-UI-SPEC "Theme in the hub"; T-04-37, T-04-38).
// 12-17 (COMM-11, D102): the banner is part of the lock map's "header" part. EditorLockFrame
// shows the LockedPanel or the HeldChangesPanel and disables the form; saveBannerAction
// parks a locked save.
import type { BannerSettings } from "@cds/core/content";
import { resolveTheme } from "@cds/core/theme";
import { getBanner, readOrganizationDesign } from "@cds/db";
import { InlineAlert, buttonClasses } from "@cds/ui/hub";
import Link from "next/link";
import { loadEditorLock } from "../../../../lib/editor-lock";
import { editorLockKey } from "../../../../lib/editor-lock-shared";
import { EditorLockFrame } from "./EditorLock";
import { requireHubSession } from "../../../../lib/session";
import { themeOrNeutral } from "../../../../lib/theme-read";
import { BannerForm } from "./BannerForm";
import { BANNER_HELD_COPY } from "./banner-status";
import { tabHref } from "./tabs";

export async function BannerTab() {
  const { ctx } = await requireHubSession();
  let banner: BannerSettings | null;
  let design: unknown;
  const lockRead = loadEditorLock(
    ctx,
    { kind: "part", key: "header" },
    { part: "banner" },
  );
  try {
    [banner, design] = await Promise.all([
      getBanner(ctx),
      themeOrNeutral(readOrganizationDesign(ctx), "hub"),
    ]);
  } catch (err) {
    console.error("[hub] getBanner failed", err);
    return (
      <InlineAlert
        tone="error"
        action={
          <Link
            href={tabHref("banner")}
            className={buttonClasses("secondary", "sm")}
          >
            Try again
          </Link>
        }
      >
        We couldn&apos;t load this. Check your connection and try again.
      </InlineAlert>
    );
  }
  const lock = await lockRead;
  return (
    <EditorLockFrame
      key={editorLockKey(lock)}
      state={lock}
      target="header"
      panelId="banner-lock"
      heldCopy={BANNER_HELD_COPY}
    >
      <BannerForm initial={banner} theme={resolveTheme(design)} />
    </EditorLockFrame>
  );
}

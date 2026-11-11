"use client";
// Page settings drawer (CONT-28; D235 #12, D-UI-P7-14; 07-UI-SPEC lines 329-336, 666;
// 07-32 choices 2, 13, 14; T-07-32-06). Right Drawer, 480px, "Page settings".
//
// Password: Switch "Protect this page with a password"; on -> a Password field (Show/Hide,
// new-password, min 6). An already protected page shows an empty field ("Leave blank to keep
// the current password"); typing a new one adds "Anyone already let in will need the new
// password." No confirm dialog (UI-SPEC 666): password changes are live on save.
// Menu: Checkbox "Show this page in the site menu" (from navHasPage on the server) and a link
// to Website › Navigation; disabled with NAV-LIMIT when adding would pass NAV_TOP_MAX.
// Footer: Save page settings (primary, disabled until dirty) · Discard changes (when dirty).
// The typed password lives only in this component's state and the one action call; it is
// never put in a toast, an alert or the URL.
// 11-30 (DASH-06; UI-SPEC "Page delete and Recently deleted" › Where): a last section with
// secondary-danger sm "Delete this page" (content write only) that opens DeletePageDialog;
// after a delete the owner lands on the Pages tab with the "{Page} deleted." Undo toast. Home
// shows "Your home page can't be deleted." instead.
import { NAV_COPY, NAV_TOP_MAX } from "@cds/core/content";
import {
  Button,
  Drawer,
  IconButton,
  InlineAlert,
  Switch,
  TextField,
  useToast,
} from "@cds/ui/hub";
import { X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  savePageSettingsAction,
  type PageSettingsInput,
  type PageSettingsResult,
} from "../../../../../actions/page-settings";
import {
  DeletePageDialog,
  PAGE_DELETE_UI_COPY,
  useDeletedPageToast,
} from "../../DeletePageDialog";
import { HOME_SLUG } from "../../page-slug";

export const PAGE_SETTINGS_COPY = Object.freeze({
  title: "Page settings",
  close: "Close",
  password: "Password",
  protect: "Protect this page with a password",
  passwordLabel: "Password",
  helper:
    "Share it with the people who should see this page. Search engines and site search skip it.",
  changeHelper: "Anyone already let in will need the new password.",
  keepPlaceholder: "Leave blank to keep the current password",
  short: "Use at least 6 characters.",
  long: "Use 128 characters or fewer.",
  show: "Show",
  hide: "Hide",
  menu: "Menu",
  inMenu: "Show this page in the site menu",
  arrange: "Arrange your menu in Website › Navigation",
  save: "Save page settings",
  discard: "Discard changes",
  saved: "Page settings saved.",
  menuFailed:
    "Saved the password, but the menu didn't update. Try again from Website › Navigation.",
  saveFailed:
    "Your changes weren't saved. Try again; if it keeps failing, reload the page.",
});

const IDS = Object.freeze({
  protect: "page-settings-protect",
  password: "page-settings-password",
  menu: "page-settings-menu",
});

export interface PageSettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  pageId: string;
  passwordProtected: boolean;
  inMenu: boolean;
  /** Top-level menu links now (07-25 navTopCount). */
  navTopCount: number;
  onSaved: (result: PageSettingsResult) => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** 11-30: the page's title and slug (Delete this page; Home can't be deleted). */
  pageTitle?: string;
  pageSlug?: string;
  /** 11-30: content write (Owner, Admin, Editor); without it there is no Delete section. */
  canDelete?: boolean;
}

/** What to send for this draft, or an inline error (exported for tests). */
export function pageSettingsPayload(
  saved: { protected: boolean; inMenu: boolean },
  draft: { protected: boolean; password: string; inMenu: boolean },
): { input: PageSettingsInput } | { error: string } {
  const input: PageSettingsInput = {};
  if (draft.protected) {
    if (draft.password !== "") {
      if (draft.password.length < 6) return { error: PAGE_SETTINGS_COPY.short };
      if (draft.password.length > 128)
        return { error: PAGE_SETTINGS_COPY.long };
      input.password = draft.password;
    } else if (!saved.protected) {
      return { error: PAGE_SETTINGS_COPY.short };
    }
  } else if (saved.protected) {
    input.password = null;
  }
  if (draft.inMenu !== saved.inMenu) input.inMenu = draft.inMenu;
  return { input };
}

export function PageSettingsDrawer({
  open,
  onClose,
  pageId,
  passwordProtected,
  inMenu: initialInMenu,
  navTopCount,
  onSaved,
  onDirtyChange,
  pageTitle = "",
  pageSlug = "",
  canDelete = false,
}: PageSettingsDrawerProps) {
  const toast = useToast();
  const router = useRouter();
  const showDeleted = useDeletedPageToast();
  const [deleting, setDeleting] = useState(false);
  const [saved, setSaved] = useState({
    protected: passwordProtected,
    inMenu: initialInMenu,
  });
  const [protect, setProtect] = useState(passwordProtected);
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const [inMenu, setInMenu] = useState(initialInMenu);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const dirty =
    protect !== saved.protected ||
    (protect && password !== "") ||
    inMenu !== saved.inMenu;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const menuFull = !saved.inMenu && navTopCount >= NAV_TOP_MAX;

  function discard() {
    setProtect(saved.protected);
    setPassword("");
    setShown(false);
    setInMenu(saved.inMenu);
    setFieldError(null);
    setAlert(null);
  }

  async function onSave() {
    const out = pageSettingsPayload(saved, {
      protected: protect,
      password,
      inMenu,
    });
    if ("error" in out) {
      setFieldError(out.error);
      return;
    }
    setFieldError(null);
    setAlert(null);
    setSaving(true);
    try {
      const res = await savePageSettingsAction(pageId, out.input);
      if (!res.ok) {
        if (
          res.message === PAGE_SETTINGS_COPY.short ||
          res.message === PAGE_SETTINGS_COPY.long
        ) {
          setFieldError(res.message);
        } else {
          setAlert(res.message || PAGE_SETTINGS_COPY.saveFailed);
        }
        return;
      }
      const next = {
        protected: res.data.page.password_protected,
        inMenu: res.data.inMenu,
      };
      setSaved(next);
      setProtect(next.protected);
      setPassword("");
      setShown(false);
      setInMenu(next.inMenu);
      onSaved(res.data);
      if (res.data.inMenuError) setAlert(PAGE_SETTINGS_COPY.menuFailed);
      else toast.show({ message: PAGE_SETTINGS_COPY.saved });
    } catch {
      setAlert(PAGE_SETTINGS_COPY.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  const changing = saved.protected && password !== "";
  const helper = changing
    ? `${PAGE_SETTINGS_COPY.helper} ${PAGE_SETTINGS_COPY.changeHelper}`
    : PAGE_SETTINGS_COPY.helper;
  const sectionClass = "flex flex-col gap-4";

  return (
    <Drawer
      open={open}
      onClose={onClose}
      label={PAGE_SETTINGS_COPY.title}
      side="right"
    >
      <div className="flex items-center justify-between gap-2 border-b border-hub-border px-6 py-4">
        <h2 className="text-xl leading-tight font-semibold">
          {PAGE_SETTINGS_COPY.title}
        </h2>
        <IconButton
          label={PAGE_SETTINGS_COPY.close}
          tooltipAlign="end"
          onClick={onClose}
          icon={<X aria-hidden size={20} strokeWidth={2} />}
        />
      </div>
      <div
        className="flex flex-1 flex-col gap-12 px-6 py-6"
        data-page-settings-drawer=""
      >
        <section aria-labelledby="ps-password-heading" className={sectionClass}>
          <h3 id="ps-password-heading" className="text-xl font-semibold">
            {PAGE_SETTINGS_COPY.password}
          </h3>
          <Switch
            id={IDS.protect}
            label={PAGE_SETTINGS_COPY.protect}
            checked={protect}
            disabled={saving}
            onChange={(v) => {
              setProtect(v);
              setFieldError(null);
            }}
          />
          {protect ? (
            <TextField
              id={IDS.password}
              label={PAGE_SETTINGS_COPY.passwordLabel}
              type={shown ? "text" : "password"}
              autoComplete="new-password"
              minLength={6}
              maxLength={128}
              value={password}
              placeholder={
                saved.protected ? PAGE_SETTINGS_COPY.keepPlaceholder : undefined
              }
              helper={helper}
              error={fieldError ?? undefined}
              disabled={saving}
              onChange={(e) => {
                setPassword(e.target.value);
                setFieldError(null);
              }}
              labelExtra={
                <button
                  type="button"
                  aria-controls={IDS.password}
                  aria-pressed={shown}
                  onClick={() => setShown((v) => !v)}
                  className="min-h-8 rounded px-1 text-sm font-semibold text-hub-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent pointer-coarse:min-h-11"
                >
                  {shown ? PAGE_SETTINGS_COPY.hide : PAGE_SETTINGS_COPY.show}
                </button>
              }
            />
          ) : null}
        </section>

        <section aria-labelledby="ps-menu-heading" className={sectionClass}>
          <h3 id="ps-menu-heading" className="text-xl font-semibold">
            {PAGE_SETTINGS_COPY.menu}
          </h3>
          <div className="flex flex-col gap-1">
            <label
              htmlFor={IDS.menu}
              className="flex min-h-10 cursor-pointer items-center gap-3 text-base text-hub-ink pointer-coarse:min-h-11"
            >
              <input
                id={IDS.menu}
                type="checkbox"
                className="h-4 w-4"
                checked={inMenu}
                disabled={saving || (menuFull && !inMenu)}
                aria-describedby={menuFull ? `${IDS.menu}-help` : undefined}
                onChange={(e) => setInMenu(e.currentTarget.checked)}
              />
              {PAGE_SETTINGS_COPY.inMenu}
            </label>
            {menuFull ? (
              <p
                id={`${IDS.menu}-help`}
                className="pl-7 text-sm text-hub-ink-muted"
              >
                {NAV_COPY.limit}
              </p>
            ) : null}
            <Link
              href="/hub/website?tab=navigation"
              className="w-fit pl-7 text-sm font-semibold text-hub-accent underline-offset-4 hover:underline"
            >
              {PAGE_SETTINGS_COPY.arrange}
            </Link>
          </div>
        </section>
        {canDelete ? (
          <section aria-labelledby="ps-delete-heading" className={sectionClass}>
            <h3 id="ps-delete-heading" className="sr-only">
              {PAGE_DELETE_UI_COPY.deleteThis}
            </h3>
            {pageSlug === HOME_SLUG ? (
              <p className="text-sm text-hub-ink-muted">
                {PAGE_DELETE_UI_COPY.homeNotDeletable}
              </p>
            ) : (
              <Button
                size="sm"
                className="w-fit text-hub-danger"
                onClick={() => setDeleting(true)}
              >
                {PAGE_DELETE_UI_COPY.deleteThis}
              </Button>
            )}
          </section>
        ) : null}
        {alert ? <InlineAlert tone="error">{alert}</InlineAlert> : null}
      </div>
      {deleting ? (
        <DeletePageDialog
          pageId={pageId}
          pageTitle={pageTitle}
          onClose={() => setDeleting(false)}
          onDeleted={(p) => {
            showDeleted(p);
            router.push("/hub/website?tab=pages");
          }}
        />
      ) : null}
      <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-hub-border bg-hub-surface px-6 py-4">
        {dirty ? (
          <Button variant="ghost" onClick={discard}>
            {PAGE_SETTINGS_COPY.discard}
          </Button>
        ) : null}
        <Button
          variant="primary"
          disabled={!dirty}
          loading={saving}
          loadingLabel="Saving…"
          onClick={() => void onSave()}
        >
          {PAGE_SETTINGS_COPY.save}
        </Button>
      </div>
    </Drawer>
  );
}

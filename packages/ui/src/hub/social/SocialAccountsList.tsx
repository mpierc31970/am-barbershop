"use client";
// My social accounts (11-37 choices 2-3; DASH-14, DASH-15, D198, D199; 11-UI-SPEC
// "Marketing › Social" lines 803-834; T-11-37-01, T-11-37-02).
//
// The list is the footer icon order. Each row: brand icon 20 · name (Body 600) + URL (Label,
// ink-muted, new tab) · "Bio link: host/ig" (+ BIO-FALLBACK when a page owns the code) · the
// CopyLinkButton "Copy link for your Instagram bio" · an overflow menu Edit, Move up, Move
// down, Remove (members who may edit only). Move up / Move down are the reorder path (WCAG
// 2.5.7 non-drag; 11-37 choice 2). Remove is immediate with an Undo toast (8 s, D119); Undo
// puts the account back where it was. Read-only members get the list and the copy buttons.
// Every write goes through `actions` (server actions in the app) and the list is replaced by
// the server's answer, so fallback flags and codes are never guessed in the browser.
import {
  CUSTOM_PLATFORM,
  findPreset,
  type SocialAccount,
} from "@cds/core/social";
import { Check, Copy, MoreHorizontal } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { HubActionResult } from "../addon-types";
import { Button } from "../Button";
import { IconButton } from "../IconButton";
import { useToast } from "../Toast";
import {
  AccountForm,
  AddAccountPicker,
  PlatformIcon,
  type AccountFormValues,
} from "./AddSocialAccount";
import {
  SOCIAL_UI_COPY as C,
  addedCopy,
  bioFallbackCopy,
  bioLinkLine,
  copiedAnnouncement,
  copyBioLabel,
  moreLabel,
  removedCopy,
} from "./copy";

export type SocialAccountsResult = HubActionResult<{
  accounts: SocialAccount[];
}>;

export interface SocialActions {
  add(input: {
    platform: string;
    label?: string;
    url: string;
  }): Promise<SocialAccountsResult>;
  update(
    id: string,
    patch: { label?: string; url?: string },
  ): Promise<SocialAccountsResult>;
  remove(id: string): Promise<SocialAccountsResult>;
  /** Undo of Remove: add it again and put it back at `index`. */
  restore(
    input: { platform: string; label?: string; url: string },
    index: number,
  ): Promise<SocialAccountsResult>;
  reorder(ids: string[]): Promise<SocialAccountsResult>;
}

export const COPIED_MS = 2000;

export interface CopyLinkButtonProps {
  name: string;
  link: string;
  /** Polite announcement (the list's live region). */
  onCopied(message: string): void;
  /**
   * P14 (14-30 choice 2): visible words (default "Copy link for your {name} bio"), the
   * accessible name (default the same), the announcement after a copy (default "{name} bio
   * link copied.") and the button look (default secondary). It copies any value, e.g. a
   * nameserver ("Copy" / "Copy nameserver 1" / "Copied nameserver 1", ghost).
   */
  label?: string;
  accessibleName?: string;
  copiedMessage?: string;
  variant?: "secondary" | "ghost";
}

/**
 * Copies the full bio link. Success: Check + "Copied" for 2 s and a polite announcement.
 * Clipboard refused or missing: the link shows selected in a read-only field ("Copy this
 * link.") so the person can copy it by hand.
 */
export function CopyLinkButton({
  name,
  link,
  onCopied,
  label,
  accessibleName,
  copiedMessage,
  variant = "secondary",
}: CopyLinkButtonProps) {
  const words = label ?? copyBioLabel(name);
  const id = useId();
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(t);
  }, [copied]);

  useEffect(() => {
    if (manual) fieldRef.current?.select();
  }, [manual]);

  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(link);
      setManual(false);
      setCopied(true);
      onCopied(copiedMessage ?? copiedAnnouncement(name));
    } catch {
      setManual(true);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        variant={variant}
        size="sm"
        aria-label={accessibleName ?? words}
        data-copy-bio={link}
        icon={
          copied ? (
            <Check aria-hidden size={16} strokeWidth={2} />
          ) : (
            <Copy aria-hidden size={16} strokeWidth={2} />
          )
        }
        onClick={() => void copy()}
      >
        {copied ? C.copied : words}
      </Button>
      {manual ? (
        <div className="flex w-full max-w-72 flex-col gap-1">
          <label
            htmlFor={`${id}-manual`}
            className="font-hub text-sm font-semibold text-hub-ink"
          >
            {C.copyManual}
          </label>
          <input
            ref={fieldRef}
            id={`${id}-manual`}
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            className="h-10 w-full rounded border border-hub-border-strong bg-hub-surface px-3 font-hub text-sm text-hub-ink"
          />
        </div>
      ) : null}
    </div>
  );
}

const MENU_ITEM =
  "flex min-h-10 w-full items-center rounded px-3 text-left text-sm " +
  "transition-colors duration-150 hover:bg-hub-surface-2 pointer-coarse:min-h-11 " +
  "aria-disabled:cursor-not-allowed aria-disabled:opacity-50 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

interface RowMenuProps {
  name: string;
  first: boolean;
  last: boolean;
  disabled: boolean;
  onEdit(): void;
  onMove(delta: -1 | 1): void;
  onRemove(): void;
}

/** Row overflow menu; focus contract as PageRowMenu (first item on open, Esc returns). */
function RowMenu({
  name,
  first,
  last,
  disabled,
  onEdit,
  onMove,
  onRemove,
}: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const trigger = () =>
    wrapRef.current?.querySelector<HTMLButtonElement>("[data-menu-trigger]") ??
    null;
  const closeToTrigger = () => {
    setOpen(false);
    trigger()?.focus();
  };

  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const wrap = wrapRef.current;
      if (wrap && e.target instanceof Node && !wrap.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const item = (
    label: string,
    act: () => void,
    opts: { off?: boolean; danger?: boolean } = {},
  ) => (
    <li>
      <button
        type="button"
        aria-disabled={opts.off || undefined}
        className={`${MENU_ITEM} cursor-pointer ${opts.danger ? "font-semibold text-hub-danger" : "text-hub-ink"}`}
        onClick={() => {
          if (opts.off) return;
          closeToTrigger();
          act();
        }}
      >
        {label}
      </button>
    </li>
  );

  return (
    <div
      ref={wrapRef}
      className="relative inline-flex"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          closeToTrigger();
        }
      }}
      onBlur={(e) => {
        const next = e.relatedTarget;
        if (open && next instanceof Node && !e.currentTarget.contains(next)) {
          setOpen(false);
        }
      }}
    >
      <IconButton
        label={moreLabel(name)}
        tooltipAlign="end"
        data-menu-trigger=""
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-disabled={disabled || undefined}
        onClick={() => {
          if (!disabled) setOpen((o) => !o);
        }}
        icon={<MoreHorizontal aria-hidden size={20} strokeWidth={2} />}
      />
      {open ? (
        <ul
          ref={listRef}
          id={menuId}
          aria-label={`${name} actions`}
          className={
            "absolute top-full right-0 z-20 mt-1 flex min-w-44 flex-col gap-1 rounded " +
            "border border-hub-border bg-hub-surface p-1 shadow-lg"
          }
        >
          {item(C.edit, onEdit)}
          {item(C.moveUp, () => onMove(-1), { off: first })}
          {item(C.moveDown, () => onMove(1), { off: last })}
          {item(C.remove, onRemove, { danger: true })}
        </ul>
      ) : null}
    </div>
  );
}

export interface SocialAccountsListProps {
  accounts: readonly SocialAccount[];
  /** The site origin bio links use (`https://riverabakery.com`); null hides the copy buttons. */
  origin: string | null;
  /** True while the site is on its preview address (BIO-PREVIEW note). */
  preview: boolean;
  /** Content write: add, edit, reorder, remove. */
  canEdit: boolean;
  actions: SocialActions;
  /** Called with the server's list after every change (Grow tips follow the platforms). */
  onChange?(accounts: SocialAccount[]): void;
}

type Editing = { kind: "add"; platform: string } | { kind: "edit"; id: string };

function bioLink(origin: string, account: SocialAccount): string {
  return `${origin.replace(/\/+$/, "")}${account.bioPath}`;
}

export function SocialAccountsList({
  accounts: initial,
  origin,
  preview,
  canEdit,
  actions,
  onChange,
}: SocialAccountsListProps) {
  const toast = useToast();
  const [accounts, setAccounts] = useState<SocialAccount[]>([...initial]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<{
    message: string;
    field?: "label" | "url";
  } | null>(null);
  const [live, setLive] = useState("");
  const headingId = useId();

  const apply = (next: SocialAccount[]) => {
    setAccounts(next);
    onChange?.(next);
  };

  const failToast = (message: string) => toast.show({ message });

  const startEditing = (e: Editing | null) => {
    setFormError(null);
    setEditing(e);
  };

  const saveForm = async (values: AccountFormValues) => {
    if (!editing) return;
    setPending(true);
    try {
      if (editing.kind === "add") {
        const platform = editing.platform;
        const res = await actions.add({
          platform,
          url: values.url,
          ...(platform === CUSTOM_PLATFORM ? { label: values.label } : {}),
        });
        if (!res.ok) {
          setFormError({
            message: res.message,
            field: res.field === "label" ? "label" : "url",
          });
          return;
        }
        apply(res.data.accounts);
        startEditing(null);
        const name =
          findPreset(platform)?.label ?? (values.label || C.nameLabel);
        toast.show({ message: addedCopy(name) });
      } else {
        const current = accounts.find((a) => a.id === editing.id);
        const res = await actions.update(editing.id, {
          url: values.url,
          ...(current?.platform === CUSTOM_PLATFORM
            ? { label: values.label }
            : {}),
        });
        if (!res.ok) {
          setFormError({
            message: res.message,
            field: res.field === "label" ? "label" : "url",
          });
          return;
        }
        apply(res.data.accounts);
        startEditing(null);
      }
    } catch {
      setFormError({ message: C.errSave });
    } finally {
      setPending(false);
    }
  };

  const move = async (index: number, delta: -1 | 1) => {
    const to = index + delta;
    if (to < 0 || to >= accounts.length) return;
    const before = accounts;
    const next = [...accounts];
    const [row] = next.splice(index, 1);
    next.splice(to, 0, row!);
    setAccounts(next);
    setLive(
      `${row!.name} moved ${delta < 0 ? "up" : "down"}, position ${to + 1} of ${next.length}.`,
    );
    setPending(true);
    try {
      const res = await actions.reorder(next.map((a) => a.id));
      if (res.ok) apply(res.data.accounts);
      else {
        setAccounts(before);
        failToast(res.message);
      }
    } catch {
      setAccounts(before);
      failToast(C.errSave);
    } finally {
      setPending(false);
    }
  };

  const remove = async (index: number) => {
    const account = accounts[index];
    if (!account) return;
    setPending(true);
    try {
      const res = await actions.remove(account.id);
      if (!res.ok) {
        failToast(res.message);
        return;
      }
      apply(res.data.accounts);
      const input = {
        platform: account.platform,
        url: account.url,
        ...(account.platform === CUSTOM_PLATFORM
          ? { label: account.label }
          : {}),
      };
      toast.show({
        message: removedCopy(account.name),
        action: {
          label: C.undo,
          onClick: () => {
            void actions
              .restore(input, index)
              .then((r) => {
                if (r.ok) apply(r.data.accounts);
                else failToast(r.message);
              })
              .catch(() => failToast(C.errSave));
          },
        },
      });
    } catch {
      failToast(C.errSave);
    } finally {
      setPending(false);
    }
  };

  const addedPresets = accounts
    .map((a) => a.platform)
    .filter((p) => p !== CUSTOM_PLATFORM);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2
          id={headingId}
          className="font-hub text-xl font-semibold text-hub-ink"
        >
          {C.heading}
        </h2>
        <p className="max-w-[68ch] font-hub text-base text-hub-ink">
          {C.intro}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-hub text-base font-semibold text-hub-ink">
          {C.yourAccounts}
        </h3>
        {accounts.length === 0 && editing?.kind !== "add" ? (
          <p className="font-hub text-base text-hub-ink-muted">{C.empty}</p>
        ) : null}
        <ul className="flex flex-col divide-y divide-hub-border" data-accounts>
          {accounts.map((a, i) =>
            editing?.kind === "edit" && editing.id === a.id ? (
              <li key={a.id} data-account={a.id}>
                <AccountForm
                  platform={a.platform}
                  initial={{ label: a.label, url: a.url }}
                  serverError={formError}
                  pending={pending}
                  onSave={(v) => void saveForm(v)}
                  onDiscard={() => startEditing(null)}
                />
              </li>
            ) : (
              <li
                key={a.id}
                data-account={a.id}
                className="flex min-h-16 flex-wrap items-start gap-3 py-4"
              >
                <span className="pt-0.5">
                  <PlatformIcon platform={a.platform} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-hub text-base font-semibold text-hub-ink">
                    {a.name}
                  </span>
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate font-hub text-sm text-hub-ink-muted underline underline-offset-2 hover:text-hub-ink"
                  >
                    {a.url}
                  </a>
                  {origin ? (
                    <span className="font-hub text-sm text-hub-ink-muted">
                      {bioLinkLine(bioLink(origin, a))}
                    </span>
                  ) : null}
                  {a.fallback ? (
                    <span
                      className="font-hub text-sm text-hub-ink-muted"
                      data-bio-fallback
                    >
                      {bioFallbackCopy(a)}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-start gap-2">
                  {origin ? (
                    <CopyLinkButton
                      name={a.name}
                      link={bioLink(origin, a)}
                      onCopied={setLive}
                    />
                  ) : null}
                  {canEdit ? (
                    <RowMenu
                      name={a.name}
                      first={i === 0}
                      last={i === accounts.length - 1}
                      disabled={pending || editing !== null}
                      onEdit={() => startEditing({ kind: "edit", id: a.id })}
                      onMove={(d) => void move(i, d)}
                      onRemove={() => void remove(i)}
                    />
                  ) : null}
                </div>
              </li>
            ),
          )}
          {editing?.kind === "add" ? (
            <li data-account="new">
              <AccountForm
                key={editing.platform}
                platform={editing.platform}
                serverError={formError}
                pending={pending}
                onSave={(v) => void saveForm(v)}
                onDiscard={() => startEditing(null)}
              />
            </li>
          ) : null}
        </ul>
        {preview && accounts.length > 0 ? (
          <p className="font-hub text-sm text-hub-ink-muted" data-bio-preview>
            {C.bioPreview}
          </p>
        ) : null}
        <p role="status" aria-live="polite" className="sr-only">
          {live}
        </p>
      </div>

      {canEdit ? (
        <AddAccountPicker
          added={addedPresets}
          disabled={pending}
          onPick={(platform) => startEditing({ kind: "add", platform })}
        />
      ) : null}
    </section>
  );
}

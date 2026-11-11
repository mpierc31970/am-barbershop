"use client";
// Pages tab row overflow menu (11-30 choice 1; UI-SPEC "Page delete and Recently deleted" ›
// Where). IconButton (MoreHorizontal, "More for {title}") → Open, Page settings, Delete page
// (danger text). Home and system rows have no Delete; a member without content write (Viewer)
// gets Open only. Menu focus contract as AddonTabHeader: opening focuses the first item; Esc
// and picking close it and return focus to the trigger; a press outside or focus leaving
// closes it. Delete opens DeletePageDialog; a delete shows the Undo toast and refreshes.
import { IconButton } from "@cds/ui/hub";
import { MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import {
  DeletePageDialog,
  PAGE_DELETE_UI_COPY,
  useDeletedPageToast,
} from "./DeletePageDialog";

const MENU_ITEM =
  "flex min-h-10 w-full items-center rounded px-3 text-left text-sm " +
  "transition-colors duration-150 hover:bg-hub-surface-2 pointer-coarse:min-h-11 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

export interface PageRowMenuProps {
  page: { id: string; title: string; slug: string };
  /** Content write (Owner, Admin, Editor): Page settings and Delete page. */
  canEdit: boolean;
  /** False for Home and system pages (no Delete item). */
  deletable: boolean;
}

function builderHref(id: string, settings = false): string {
  const base = `/hub/website/pages/${encodeURIComponent(id)}`;
  return settings ? `${base}?settings=1` : base;
}

export function PageRowMenu({ page, canEdit, deletable }: PageRowMenuProps) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const router = useRouter();
  const showDeleted = useDeletedPageToast();

  const trigger = () =>
    wrapRef.current?.querySelector<HTMLButtonElement>("[data-menu-trigger]") ??
    null;
  const closeToTrigger = () => {
    setOpen(false);
    trigger()?.focus();
  };

  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>("a,button")?.focus();
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

  return (
    <div
      ref={wrapRef}
      className="relative inline-flex"
      data-page-menu={page.id}
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
        label={PAGE_DELETE_UI_COPY.rowMenu(page.title)}
        tooltipAlign="end"
        data-menu-trigger=""
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        icon={<MoreHorizontal aria-hidden size={20} strokeWidth={2} />}
      />
      {open ? (
        <ul
          ref={listRef}
          id={menuId}
          aria-label={`${page.title} actions`}
          className={
            "absolute top-full right-0 z-20 mt-1 flex min-w-48 flex-col gap-1 rounded " +
            "border border-hub-border bg-hub-surface p-1 shadow-lg"
          }
        >
          <li>
            <Link
              href={builderHref(page.id)}
              className={`${MENU_ITEM} text-hub-ink`}
            >
              {PAGE_DELETE_UI_COPY.open}
            </Link>
          </li>
          {canEdit ? (
            <li>
              <Link
                href={builderHref(page.id, true)}
                className={`${MENU_ITEM} text-hub-ink`}
              >
                {PAGE_DELETE_UI_COPY.settings}
              </Link>
            </li>
          ) : null}
          {canEdit && deletable ? (
            <li>
              <button
                type="button"
                className={`${MENU_ITEM} cursor-pointer font-semibold text-hub-danger`}
                onClick={() => {
                  // Focus goes back to the trigger first, so the dialog returns it there.
                  closeToTrigger();
                  setDeleting(true);
                }}
              >
                {PAGE_DELETE_UI_COPY.deleteItem}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
      {deleting ? (
        <DeletePageDialog
          pageId={page.id}
          pageTitle={page.title}
          onClose={() => setDeleting(false)}
          onDeleted={(p) => {
            showDeleted(p);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

"use client";
// Website › Forms list (07-18; CONT-25, D311; 07-UI-SPEC "Forms › List", EMPTY-FORMS). Header:
// Heading "Forms", the how-to IconButton, the count and Create form (the view's one primary;
// hidden while empty or for read-only members). Rows are 56px and not sortable: the name is
// a button that opens the editor, the meta line names the template, the field count and the
// pages (linked to the builder), "In review" is a badge and "N unread" links to the Inbox
// (hidden at 0). The overflow menu has Edit, View messages and, for writers, Duplicate form
// and Delete form. Names render as React text. No fetching: actions arrive as props.
import { CircleHelp, Ellipsis, Plus } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type KeyboardEvent,
} from "react";
import type { HubLinkComponent } from "../AddonCard";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { IconButton } from "../IconButton";
import { EmptyState } from "../feedback";
import {
  CREATE_FORM,
  EMPTY_FORMS,
  FORMS_HEADING,
  IN_REVIEW,
  formCountLabel,
  formMetaParts,
  inboxHref,
  pageHref,
  unreadLabel,
  type FormRowView,
} from "./form-logic";

export interface FormsListProps {
  forms: readonly FormRowView[];
  canWrite: boolean;
  selectedId?: string | null;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onHowTo: () => void;
  LinkComponent?: HubLinkComponent;
}

const LINK =
  "font-semibold text-hub-accent underline-offset-2 hover:underline " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

function PlainLink(
  props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string },
) {
  return <a {...props} />;
}

export function FormsList({
  forms,
  canWrite,
  selectedId,
  onOpen,
  onCreate,
  onDuplicate,
  onDelete,
  onHowTo,
  LinkComponent = PlainLink,
}: FormsListProps) {
  const empty = forms.length === 0;
  return (
    <section
      aria-labelledby="forms-heading"
      className="flex flex-col gap-4 font-hub"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2
          id="forms-heading"
          className="text-xl leading-tight font-semibold text-hub-ink"
        >
          {FORMS_HEADING}
        </h2>
        <IconButton
          label="How Forms works"
          icon={<CircleHelp aria-hidden size={20} strokeWidth={2} />}
          onClick={onHowTo}
        />
        {empty ? null : (
          <span className="text-sm text-hub-ink-muted tabular-nums">
            {formCountLabel(forms.length)}
          </span>
        )}
        <span className="flex-1" />
        {empty || !canWrite ? null : (
          <Button
            variant="primary"
            icon={<Plus aria-hidden size={16} strokeWidth={2} />}
            onClick={onCreate}
          >
            {CREATE_FORM}
          </Button>
        )}
      </div>
      {empty ? (
        <div className="flex flex-col gap-2">
          <EmptyState
            heading={EMPTY_FORMS.heading}
            body={EMPTY_FORMS.body}
            action={
              canWrite ? (
                <Button variant="primary" onClick={onCreate}>
                  {CREATE_FORM}
                </Button>
              ) : undefined
            }
          />
          <p className="text-center text-sm text-hub-ink-muted">
            {EMPTY_FORMS.helper}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col rounded border border-hub-border bg-hub-surface">
          {forms.map((f) => (
            <FormRow
              key={f.id}
              form={f}
              selected={selectedId === f.id}
              canWrite={canWrite}
              onOpen={() => onOpen(f.id)}
              onDuplicate={() => onDuplicate(f.id)}
              onDelete={() => onDelete(f.id)}
              LinkComponent={LinkComponent}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function FormRow({
  form,
  selected,
  canWrite,
  onOpen,
  onDuplicate,
  onDelete,
  LinkComponent,
}: {
  form: FormRowView;
  selected: boolean;
  canWrite: boolean;
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  LinkComponent: HubLinkComponent;
}) {
  const meta = formMetaParts(form, form.usage);
  const unread = unreadLabel(form.unread);
  return (
    <li
      data-form-row={form.id}
      className={
        "flex min-h-14 items-center gap-3 border-b border-hub-border px-4 py-2 last:border-b-0 " +
        (selected ? "bg-hub-accent-tint" : "")
      }
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onOpen}
            aria-current={selected ? "true" : undefined}
            className={
              "truncate text-left text-base font-semibold text-hub-ink hover:underline " +
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
            }
          >
            {form.name}
          </button>
          {form.inReview ? <Badge tone="review">{IN_REVIEW}</Badge> : null}
        </span>
        <span className="truncate text-sm text-hub-ink-muted" data-form-meta="">
          {meta.base}
          {meta.pages.length > 0 ? (
            <>
              {" · On "}
              {meta.pages.map((p, i) => (
                <span key={p.id}>
                  {i > 0 ? ", " : ""}
                  <LinkComponent
                    href={pageHref(p.id)}
                    className="underline-offset-2 hover:underline"
                  >
                    {p.title}
                  </LinkComponent>
                </span>
              ))}
            </>
          ) : null}
          {meta.popups ? ` · ${meta.popups}` : null}
          {meta.notUsed ? " · Not on any page yet" : null}
        </span>
      </div>
      {unread ? (
        <LinkComponent
          href={inboxHref(form.id)}
          className={`text-sm tabular-nums ${LINK}`}
        >
          {unread}
        </LinkComponent>
      ) : null}
      <RowMenu
        name={form.name}
        canWrite={canWrite}
        inbox={inboxHref(form.id)}
        onEdit={onOpen}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
        LinkComponent={LinkComponent}
      />
    </li>
  );
}

function RowMenu({
  name,
  canWrite,
  inbox,
  onEdit,
  onDuplicate,
  onDelete,
  LinkComponent,
}: {
  name: string;
  canWrite: boolean;
  inbox: string;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  LinkComponent: HubLinkComponent;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function close(refocus: boolean) {
    setOpen(false);
    if (refocus)
      wrap.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      close(true);
    }
  }

  const item =
    "flex min-h-11 w-full items-center px-3 text-left text-base text-hub-ink " +
    "hover:bg-hub-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 " +
    "focus-visible:outline-hub-accent";
  const run = (fn: () => void) => () => {
    close(false);
    fn();
  };
  return (
    <div ref={wrap} className="relative" onKeyDown={onKeyDown}>
      <IconButton
        label={`More for ${name}`}
        tooltipAlign="end"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        icon={<Ellipsis aria-hidden size={20} strokeWidth={2} />}
        onClick={() => setOpen((o) => !o)}
      />
      {open ? (
        <ul
          id={menuId}
          aria-label={`More for ${name}`}
          className="absolute top-full right-0 z-20 mt-1 flex min-w-48 flex-col rounded border border-hub-border bg-hub-surface py-1 shadow-lg"
        >
          <li>
            <button type="button" className={item} onClick={run(onEdit)}>
              Edit
            </button>
          </li>
          <li>
            <LinkComponent href={inbox} className={item}>
              View messages
            </LinkComponent>
          </li>
          {canWrite ? (
            <>
              <li>
                <button
                  type="button"
                  className={item}
                  onClick={run(onDuplicate)}
                >
                  Duplicate form
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={`${item} text-hub-danger`}
                  onClick={run(onDelete)}
                >
                  Delete form
                </button>
              </li>
            </>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

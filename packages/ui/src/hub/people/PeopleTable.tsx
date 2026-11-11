"use client";
// Settings › People & roles panel (11-39; 11-UI-SPEC "Settings › People & roles" lines
// 847-873, "Destructive actions"; D285, D311, D-UI-P11-21). Content max-width 880px.
//   - Heading "People who can use this hub" + primary Invite someone (Owner, not
//     impersonating), PEOPLE-INTRO under it.
//   - One table (cards below 768px through block rows): Person (name + email) · Role badge ·
//     Add-on access · Status (Invited · sent 9 Oct) · overflow actions. People first (Owner,
//     then role, then name, as the server sorts), then pending invites.
//   - Owner row: role Owner, "You" when it is you, never any actions.
//   - Admin: no buttons, the "Only the site owner…" label. Impersonating staff: no buttons +
//     IMPERSONATING-PEOPLE info alert.
//   - Remove: danger Dialog naming the person, "Keep {Sam}" autofocused. Cancel invite: at
//     once + Undo toast (Undo sends a fresh invite with the same role and access). Every
//     change answers with the server's fresh lists.
import { MoreHorizontal } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { Dialog } from "../Dialog";
import { InlineAlert } from "../feedback";
import { IconButton } from "../IconButton";
import { useToast } from "../Toast";
import { InviteDialog } from "./InviteDialog";
import { RoleGrantsDrawer } from "./RoleGrantsDrawer";
import {
  INVITE_EXPIRED_STATUS,
  PEOPLE_COPY as C,
  ROLE_LABEL,
  accessSavedCopy,
  accessSummary,
  inviteCancelledCopy,
  inviteResentCopy,
  inviteSentCopy,
  invitedStatus,
  isInvitableRole,
  keepPersonLabel,
  moreLabel,
  removeTitle,
  removedCopy,
  roleChangedCopy,
  shortName,
  type AddonAccessOption,
  type InviteView,
  type PeopleActions,
  type PeopleLists,
  type PeopleResult,
  type PersonView,
} from "./copy";

/** Who is looking: the Owner manages; Admins and impersonating staff only read. */
export type PeopleViewer = "owner" | "admin" | "impersonating";

export interface PeopleTableProps {
  people: readonly PersonView[];
  invites: readonly InviteView[];
  addons: readonly AddonAccessOption[];
  orgName: string;
  viewer: PeopleViewer;
  actions: PeopleActions;
}

const MENU_ITEM =
  "flex min-h-10 w-full items-center rounded px-3 text-left text-sm " +
  "transition-colors duration-150 hover:bg-hub-surface-2 pointer-coarse:min-h-11 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

interface MenuItem {
  label: string;
  run(): void;
  danger?: boolean;
}

/** Row overflow menu; focus contract as the Social RowMenu (first item on open, Esc returns). */
function RowMenu({ who, items }: { who: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const closeToTrigger = () => {
    setOpen(false);
    wrapRef.current
      ?.querySelector<HTMLButtonElement>("[data-menu-trigger]")
      ?.focus();
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
        label={moreLabel(who)}
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
          aria-label={`${who} actions`}
          className={
            "absolute top-full right-0 z-20 mt-1 flex min-w-52 flex-col gap-1 rounded " +
            "border border-hub-border bg-hub-surface p-1 shadow-lg"
          }
        >
          {items.map((it) => (
            <li key={it.label}>
              <button
                type="button"
                className={`${MENU_ITEM} cursor-pointer ${it.danger ? "font-semibold text-hub-danger" : "text-hub-ink"}`}
                onClick={() => {
                  closeToTrigger();
                  it.run();
                }}
              >
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// Below 768px each row becomes a card: rows and cells are blocks, the header row hides and
// each cell carries its own small label.
const TR =
  "block border-b border-hub-border py-3 md:table-row md:py-0 last:border-b-0";
const TD = "block py-1 align-middle md:table-cell md:px-3 md:py-3";
const CELL_LABEL = "text-sm font-semibold text-hub-ink-muted md:hidden";

function Cell({
  label,
  children,
  className,
}: {
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <td className={`${TD}${className ? ` ${className}` : ""}`}>
      {label ? <span className={`${CELL_LABEL} mr-2`}>{label}</span> : null}
      {children}
    </td>
  );
}

export function PeopleTable({
  people: initialPeople,
  invites: initialInvites,
  addons,
  orgName,
  viewer,
  actions,
}: PeopleTableProps) {
  const toast = useToast();
  const headingId = useId();
  const [lists, setLists] = useState<PeopleLists>({
    people: [...initialPeople],
    invites: [...initialInvites],
  });
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<PersonView | null>(null);
  const [removing, setRemoving] = useState<PersonView | null>(null);
  const [removePending, setRemovePending] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const canManage = viewer === "owner";

  useEffect(() => {
    if (rowError) errorRef.current?.focus();
  }, [rowError]);

  const apply = (res: PeopleResult): boolean => {
    if (res.ok) {
      setLists(res.data);
      setRowError(null);
      return true;
    }
    setRowError(res.message);
    return false;
  };

  const resend = async (inv: InviteView) => {
    const res = await actions.resend(inv.id);
    if (apply(res)) toast.show({ message: inviteResentCopy(inv.email) });
  };

  const cancelInvite = async (inv: InviteView) => {
    const res = await actions.revoke(inv.id);
    if (!apply(res)) return;
    toast.show({
      message: inviteCancelledCopy(inv.email),
      action: {
        label: C.undo,
        onClick: () => {
          if (!isInvitableRole(inv.role)) return;
          void actions
            .invite({ email: inv.email, role: inv.role, grants: inv.grants })
            .then((again) => {
              if (apply(again)) {
                toast.show({ message: inviteSentCopy(inv.email) });
              }
            });
        },
      },
    });
  };

  const confirmRemove = async () => {
    if (!removing || removePending) return;
    setRemovePending(true);
    setRemoveError(null);
    const res = await actions.remove(removing.id);
    setRemovePending(false);
    if (!res.ok) {
      setRemoveError(res.message);
      return;
    }
    setLists(res.data);
    toast.show({ message: removedCopy(shortName(removing)) });
    setRemoving(null);
  };

  const onlyOwner =
    lists.people.every((p) => p.role === "owner") && lists.invites.length === 0;

  return (
    <section
      aria-labelledby={headingId}
      className="flex max-w-[880px] flex-col gap-6"
      data-people-panel=""
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2
            id={headingId}
            className="text-xl leading-tight font-semibold text-hub-ink"
          >
            {C.heading}
          </h2>
          {canManage ? (
            <Button variant="primary" onClick={() => setInviting(true)}>
              {C.invite}
            </Button>
          ) : null}
        </div>
        <p className="max-w-[68ch] text-base text-hub-ink-muted">{C.intro}</p>
        {viewer === "admin" ? (
          <p className="text-sm font-semibold text-hub-ink-muted">
            {C.adminNote}
          </p>
        ) : null}
      </div>

      {viewer === "impersonating" ? (
        <InlineAlert tone="info">{C.impersonating}</InlineAlert>
      ) : null}

      {rowError ? (
        <div ref={errorRef} tabIndex={-1}>
          <InlineAlert tone="error">{rowError}</InlineAlert>
        </div>
      ) : null}

      <table className="block w-full border-collapse text-left md:table">
        <thead className="sr-only md:not-sr-only md:table-header-group">
          <tr className="border-b border-hub-border-strong">
            <th scope="col" className="px-3 py-2 text-sm font-semibold">
              {C.colPerson}
            </th>
            <th scope="col" className="px-3 py-2 text-sm font-semibold">
              {C.colRole}
            </th>
            <th scope="col" className="px-3 py-2 text-sm font-semibold">
              {C.colAccess}
            </th>
            <th scope="col" className="px-3 py-2 text-sm font-semibold">
              {C.colStatus}
            </th>
            <th scope="col" className="px-3 py-2 text-sm font-semibold">
              <span className="sr-only">{C.colActions}</span>
            </th>
          </tr>
        </thead>
        <tbody className="block md:table-row-group">
          {lists.people.map((p) => {
            const who = p.name || p.email;
            const manageable = canManage && p.role !== "owner" && !p.isYou;
            return (
              <tr key={p.id} className={TR} data-person-row={p.id}>
                <Cell>
                  <span className="flex flex-col">
                    <span className="flex items-center gap-2 text-base font-semibold text-hub-ink">
                      {who}
                      {p.isYou ? (
                        <span className="text-sm font-semibold text-hub-ink-muted">
                          {C.you}
                        </span>
                      ) : null}
                    </span>
                    {p.name ? (
                      <span className="text-sm text-hub-ink-muted">
                        {p.email}
                      </span>
                    ) : null}
                  </span>
                </Cell>
                <Cell label={C.colRole}>
                  <Badge tone="role">{ROLE_LABEL[p.role]}</Badge>
                </Cell>
                <Cell label={C.colAccess}>
                  <span className="text-sm text-hub-ink">
                    {accessSummary(p.role, p.grants, addons)}
                  </span>
                </Cell>
                <Cell>{null}</Cell>
                <Cell className="md:text-right">
                  {manageable ? (
                    <RowMenu
                      who={who}
                      items={[
                        {
                          label: C.changeRole,
                          run: () => setEditing(p),
                        },
                        {
                          label: C.remove,
                          danger: true,
                          run: () => {
                            setRemoveError(null);
                            setRemoving(p);
                          },
                        },
                      ]}
                    />
                  ) : null}
                </Cell>
              </tr>
            );
          })}
          {lists.invites.map((inv) => (
            <tr key={inv.id} className={TR} data-invite-row={inv.id}>
              <Cell>
                <span className="text-base font-semibold text-hub-ink">
                  {inv.email}
                </span>
              </Cell>
              <Cell label={C.colRole}>
                <Badge tone="role">{ROLE_LABEL[inv.role]}</Badge>
              </Cell>
              <Cell label={C.colAccess}>
                <span className="text-sm text-hub-ink">
                  {accessSummary(inv.role, inv.grants, addons)}
                </span>
              </Cell>
              <Cell>
                {inv.expired ? (
                  <Badge tone="expired">{INVITE_EXPIRED_STATUS}</Badge>
                ) : (
                  <Badge tone="invited">{invitedStatus(inv.sentOn)}</Badge>
                )}
              </Cell>
              <Cell className="md:text-right">
                {canManage ? (
                  <RowMenu
                    who={inv.email}
                    items={[
                      { label: C.resend, run: () => void resend(inv) },
                      {
                        label: C.cancelInvite,
                        danger: true,
                        run: () => void cancelInvite(inv),
                      },
                    ]}
                  />
                ) : null}
              </Cell>
            </tr>
          ))}
        </tbody>
      </table>

      {onlyOwner ? (
        <p className="text-base text-hub-ink-muted">{C.empty}</p>
      ) : null}

      {canManage ? (
        <>
          <InviteDialog
            open={inviting}
            onClose={() => setInviting(false)}
            addons={addons}
            onInvite={actions.invite}
            onSent={(email, res) => {
              setLists(res.data);
              setRowError(null);
              toast.show({ message: inviteSentCopy(email) });
            }}
          />
          <RoleGrantsDrawer
            person={editing}
            onClose={() => setEditing(null)}
            addons={addons}
            onChangeRole={actions.changeRole}
            onSetGrants={actions.setGrants}
            onSaved={(res, change) => {
              setLists(res.data);
              setRowError(null);
              const name = editing ? shortName(editing) : "";
              toast.show({
                message: change.roleChanged
                  ? roleChangedCopy(name, change.role)
                  : accessSavedCopy(name),
              });
            }}
          />
          <Dialog
            open={removing !== null}
            onClose={() => setRemoving(null)}
            title={
              removing ? removeTitle(shortName(removing), orgName) : C.remove
            }
            footer={
              removing ? (
                <>
                  <Button
                    variant="destructive"
                    loading={removePending}
                    loadingLabel={C.removing}
                    onClick={() => void confirmRemove()}
                  >
                    {C.removeConfirm}
                  </Button>
                  <Button
                    variant="secondary"
                    autoFocus
                    onClick={() => setRemoving(null)}
                  >
                    {keepPersonLabel(shortName(removing))}
                  </Button>
                </>
              ) : null
            }
          >
            <div className="flex flex-col gap-3">
              <p>{C.removeBody}</p>
              {removeError ? (
                <InlineAlert tone="error">{removeError}</InlineAlert>
              ) : null}
            </div>
          </Dialog>
        </>
      ) : null}
    </section>
  );
}

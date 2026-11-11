"use client";
// Change role (11-39 choice 2; 11-UI-SPEC "Settings › People & roles" RoleDialog; D285). A
// right Drawer with the same Role cards and Add-on access checkboxes as the invite, preset
// to the person's access; only active add-ons are listed. Save role saves the role, then the
// add-on access when it changed. Lowering someone's access (Admin -> Editor, Editor ->
// Viewer...) asks first: a warning step names the change, with the safe "Keep {role}"
// focused. Refusals show inline and take focus; nothing changes on the page until the
// server answers with the fresh lists.
import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../Button";
import { Drawer } from "../Drawer";
import { InlineAlert } from "../feedback";
import { IconButton } from "../IconButton";
import { RoleAccessFields } from "./InviteDialog";
import {
  PEOPLE_COPY as C,
  isInvitableRole,
  keepRoleLabel,
  lowerBody,
  lowerConfirmLabel,
  lowerTitle,
  lowersAccess,
  shortName,
  takesGrants,
  type AddonAccessOption,
  type InvitableRole,
  type PeopleResult,
  type PersonView,
} from "./copy";

export interface RoleGrantsDrawerProps {
  person: PersonView | null;
  onClose(): void;
  addons: readonly AddonAccessOption[];
  onChangeRole(
    membershipId: string,
    role: InvitableRole,
  ): Promise<PeopleResult>;
  onSetGrants(membershipId: string, grants: string[]): Promise<PeopleResult>;
  /**
   * Fresh lists after a save; `roleChanged` says which toast to show. Also called with the
   * drawer still open when the role saved but the access save then failed (WR-D03).
   */
  onSaved(
    result: Extract<PeopleResult, { ok: true }>,
    change: { roleChanged: boolean; role: InvitableRole },
  ): void;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

export function RoleGrantsDrawer({
  person,
  onClose,
  addons,
  onChangeRole,
  onSetGrants,
  onSaved,
}: RoleGrantsDrawerProps) {
  const titleId = useId();
  const startRole: InvitableRole | null =
    person && isInvitableRole(person.role) ? person.role : null;
  const [role, setRole] = useState<InvitableRole | null>(startRole);
  const [grants, setGrants] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Review 11 WR-D03: a role already saved in this drawer (its access save failed after).
  // It becomes the baseline, so Save again neither re-sends it nor asks to confirm it.
  const [savedRole, setSavedRole] = useState<InvitableRole | null>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRole(person && isInvitableRole(person.role) ? person.role : null);
    setGrants(
      person
        ? person.grants.filter((g) => addons.some((a) => a.slug === g))
        : [],
    );
    setConfirming(false);
    setPending(false);
    setError(null);
    setSavedRole(null);
  }, [person, addons]);

  useEffect(() => {
    if (confirming) keepRef.current?.focus();
  }, [confirming]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  if (!person) {
    return (
      <Drawer open={false} onClose={onClose} label={C.changeRole} side="right">
        {null}
      </Drawer>
    );
  }
  const name = shortName(person);
  const from = savedRole ?? person.role;

  const save = async (confirmed: boolean) => {
    if (!role || pending) return;
    if (!confirmed && lowersAccess(from, role)) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setError(null);
    setPending(true);
    const roleChanged = role !== from;
    let last: PeopleResult | null = null;
    if (roleChanged) {
      last = await onChangeRole(person.id, role);
      if (!last.ok) {
        setPending(false);
        setError(last.message);
        return;
      }
    }
    const roleSaved = last;
    const want = takesGrants(role) ? grants : [];
    const had = person.grants.filter((g) => addons.some((a) => a.slug === g));
    if (takesGrants(role) && !sameSet(want, had)) {
      last = await onSetGrants(person.id, want);
      if (!last.ok) {
        setPending(false);
        setError(last.message);
        if (roleSaved?.ok) {
          // The role did save: show it in the table now and keep the drawer open on the
          // access error.
          setSavedRole(role);
          onSaved(roleSaved, { roleChanged: true, role });
        }
        return;
      }
    }
    setPending(false);
    if (last && last.ok) onSaved(last, { roleChanged, role });
    onClose();
  };

  return (
    <Drawer
      open
      onClose={onClose}
      label={`${C.changeRole}: ${name}`}
      side="right"
    >
      <div className="flex min-h-full flex-col" data-role-drawer="">
        <div className="flex items-start justify-between gap-4 border-b border-hub-border p-6">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id={titleId} className="text-xl leading-tight font-semibold">
              {C.changeRole}
            </h2>
            <p className="truncate text-sm text-hub-ink-muted">
              {person.name ? `${person.name} · ${person.email}` : person.email}
            </p>
          </div>
          <IconButton
            label="Close"
            onClick={onClose}
            icon={<X aria-hidden size={20} strokeWidth={2} />}
          />
        </div>
        <form
          className="flex flex-1 flex-col gap-6 p-6"
          aria-labelledby={titleId}
          onSubmit={(e) => {
            e.preventDefault();
            void save(false);
          }}
        >
          {error ? (
            <div ref={errorRef} tabIndex={-1}>
              <InlineAlert tone="error">{error}</InlineAlert>
            </div>
          ) : null}
          <RoleAccessFields
            name={`role-${person.id}`}
            role={role}
            onRole={(r) => {
              setRole(r);
              setConfirming(false);
            }}
            grants={grants}
            onGrants={setGrants}
            addons={addons}
          />
          {confirming && role ? (
            <div data-lower-confirm="">
              <InlineAlert
                tone="warning"
                title={lowerTitle(name, from, role)}
                action={
                  <div className="flex flex-wrap gap-2">
                    <Button
                      ref={keepRef}
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setRole(startRole);
                        setConfirming(false);
                      }}
                    >
                      {keepRoleLabel(from)}
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => void save(true)}
                    >
                      {lowerConfirmLabel(role)}
                    </Button>
                  </div>
                }
              >
                {lowerBody(name, role)}
              </InlineAlert>
            </div>
          ) : (
            <div className="mt-auto flex flex-wrap justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={onClose} disabled={pending}>
                {keepRoleLabel(from)}
              </Button>
              <Button
                variant="primary"
                type="submit"
                loading={pending}
                loadingLabel={C.saving}
              >
                {C.saveRole}
              </Button>
            </div>
          )}
        </form>
      </div>
    </Drawer>
  );
}

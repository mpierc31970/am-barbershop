"use client";
// Invite someone (11-39; 11-UI-SPEC "Settings › People & roles" InviteDialog; D285). Dialog:
// Email TextField, Role RadioCardGroup (Admin · Editor · Viewer with ROLE-* copy; Staff and
// Renter are not offered in v1.0, so the ROLE-MORE label shows, D-UI-P11-22), and Add-on
// access checkboxes for roles that take grants (one per active add-on). Send invite checks
// the email shape and the role first; server refusals (INVITE-EXISTS, INVITE-INVALID) show
// inline under Email and take focus. RoleAccessFields is shared with RoleGrantsDrawer.
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../Button";
import { Dialog } from "../Dialog";
import { TextField } from "../fields";
import { InlineAlert } from "../feedback";
import { RadioCardGroup } from "../RadioCardGroup";
import {
  INVITABLE_ROLES,
  PEOPLE_COPY as C,
  ROLE_DESCRIPTION,
  ROLE_LABEL,
  looksLikeEmail,
  takesGrants,
  type AddonAccessOption,
  type InvitableRole,
  type PeopleResult,
} from "./copy";

export interface RoleAccessFieldsProps {
  name: string;
  role: InvitableRole | null;
  onRole(role: InvitableRole): void;
  grants: readonly string[];
  onGrants(grants: string[]): void;
  addons: readonly AddonAccessOption[];
  roleError?: string | null;
}

/** Role cards + the Add-on access fieldset (shown for roles that take grants). */
export function RoleAccessFields({
  name,
  role,
  onRole,
  grants,
  onGrants,
  addons,
  roleError,
}: RoleAccessFieldsProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-4">
      <RadioCardGroup<InvitableRole>
        name={`${name}-role`}
        legend={C.role}
        value={role}
        onChange={onRole}
        options={INVITABLE_ROLES.map((r) => ({
          value: r,
          title: ROLE_LABEL[r],
          description: ROLE_DESCRIPTION[r],
        }))}
      />
      {roleError ? (
        <p role="alert" className="text-sm text-hub-danger">
          {roleError}
        </p>
      ) : null}
      <p className="text-sm text-hub-ink-muted">{C.roleMore}</p>
      {role && takesGrants(role) && addons.length > 0 ? (
        <fieldset className="flex flex-col gap-1" data-addon-access="">
          <legend className="mb-1 text-sm font-semibold text-hub-ink">
            {C.access}
          </legend>
          <p className="mb-1 text-sm text-hub-ink-muted">{C.accessHelp}</p>
          {addons.map((a) => {
            const boxId = `${id}-${a.slug}`;
            const on = grants.includes(a.slug);
            return (
              <label
                key={a.slug}
                htmlFor={boxId}
                className="flex min-h-11 cursor-pointer items-center gap-3 text-base"
              >
                <input
                  id={boxId}
                  type="checkbox"
                  value={a.slug}
                  checked={on}
                  onChange={(e) => {
                    const checked = e.currentTarget.checked;
                    onGrants(
                      checked
                        ? [...grants.filter((g) => g !== a.slug), a.slug]
                        : grants.filter((g) => g !== a.slug),
                    );
                  }}
                  className="h-5 w-5 shrink-0 accent-hub-accent"
                />
                <span>{a.name}</span>
              </label>
            );
          })}
        </fieldset>
      ) : null}
    </div>
  );
}

export interface InviteDialogProps {
  open: boolean;
  onClose(): void;
  addons: readonly AddonAccessOption[];
  onInvite(input: {
    email: string;
    role: InvitableRole;
    grants: string[];
  }): Promise<PeopleResult>;
  /** Called with the server's fresh lists after a sent invite. */
  onSent(email: string, result: Extract<PeopleResult, { ok: true }>): void;
}

const ROLE_REQUIRED = "Choose a role.";

export function InviteDialog({
  open,
  onClose,
  addons,
  onInvite,
  onSent,
}: InviteDialogProps) {
  const emailId = useId();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole | null>(null);
  const [grants, setGrants] = useState<string[]>([]);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const focusEmail = () =>
    (document.getElementById(emailId) as HTMLInputElement | null)?.focus();
  const alertRef = useRef<HTMLDivElement>(null);

  // A fresh form every time it opens.
  useEffect(() => {
    if (!open) return;
    setEmail("");
    setRole(null);
    setGrants([]);
    setEmailError(null);
    setRoleError(null);
    setFormError(null);
    setPending(false);
  }, [open]);

  useEffect(() => {
    if (formError) alertRef.current?.focus();
  }, [formError]);

  const submit = async () => {
    if (pending) return;
    const clean = email.trim();
    const badEmail = !looksLikeEmail(clean);
    setEmailError(badEmail ? C.inviteInvalid : null);
    setRoleError(role ? null : ROLE_REQUIRED);
    setFormError(null);
    if (badEmail) {
      focusEmail();
      return;
    }
    if (!role) return;
    setPending(true);
    const res = await onInvite({
      email: clean,
      role,
      grants: takesGrants(role)
        ? grants.filter((g) => addons.some((a) => a.slug === g))
        : [],
    });
    setPending(false);
    if (res.ok) {
      onSent(clean, res);
      onClose();
      return;
    }
    if (res.field === "email") {
      setEmailError(res.message);
      focusEmail();
    } else {
      setFormError(res.message);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={C.inviteTitle}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {C.notNow}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={`${emailId}-form`}
            loading={pending}
            loadingLabel={C.sending}
          >
            {C.sendInvite}
          </Button>
        </>
      }
    >
      <form
        id={`${emailId}-form`}
        noValidate
        className="flex flex-col gap-6"
        data-invite-form=""
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {formError ? (
          <div ref={alertRef} tabIndex={-1}>
            <InlineAlert tone="error">{formError}</InlineAlert>
          </div>
        ) : null}
        <TextField
          id={emailId}
          label={C.email}
          type="email"
          name="email"
          autoComplete="off"
          inputMode="email"
          value={email}
          error={emailError}
          onChange={(e) => setEmail(e.currentTarget.value)}
        />
        <RoleAccessFields
          name="invite"
          role={role}
          onRole={(r) => {
            setRole(r);
            setRoleError(null);
          }}
          grants={grants}
          onGrants={setGrants}
          addons={addons}
          roleError={roleError}
        />
      </form>
    </Dialog>
  );
}

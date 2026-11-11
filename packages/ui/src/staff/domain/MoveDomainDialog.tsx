"use client";
// MoveDomainDialog (14-38 choice 2; DOM-08, D169, P14-P38; 14-UI-SPEC "Move domain", dialogs
// table). Two stages: a Dialog with **New domain** and the consequence Label ("The site stays
// on riverabakery.com until the move finishes. …") · **Next** / **Not now**; then a CaseDialog
// "Move Rivera Bakery to riverabakery.net?" with the consequence lines, the case, a required
// 10-500 **Reason** · **Start move** / **Not now** (focused). Step-up happens when Start move
// runs: the server answers step_up_needed and useStaffAction asks for the emailed code, then
// retries the same call (P13 pattern). The domain is checked locally with parseDomainInput;
// the server re-checks everything (14-37 staffStartMove).
// MoveDomainButton: the super_admin trigger for live sites; a support_agent sees it disabled
// with "Super Admin only" (T-14-38-02).
import { P14_COPY, parseDomainInput } from "@cds/core/dns";
import { ArrowRightLeft } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "../../hub/Button";
import { Dialog } from "../../hub/Dialog";
import { TextField } from "../../hub/fields";
import { CaseDialog } from "../dialogs";
import { STAFF_DOMAIN_COPY, type StaffDomainStartMoveAction } from "./copy";
import { SuperOnly, useDomainRun } from "./parts";

const C = STAFF_DOMAIN_COPY.moveDialog;
const T = STAFF_DOMAIN_COPY.timeline;

export interface MoveDomainDialogProps {
  open: boolean;
  onClose: () => void;
  orgId: string;
  business: string;
  /** The domain the site is on now. */
  currentDomain: string;
  /** Platform hosts that are never a tenant domain (parseDomainInput reserved list). */
  platformHosts?: readonly string[];
  action: StaffDomainStartMoveAction;
}

export function MoveDomainDialog({
  open,
  onClose,
  orgId,
  business,
  currentDomain,
  platformHosts = [],
  action,
}: MoveDomainDialogProps) {
  const id = useId();
  const [stage, setStage] = useState<"input" | "case">("input");
  const [raw, setRaw] = useState("");
  const [domain, setDomain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { run } = useDomainRun(
    action,
    `${P14_COPY.BTN_START_MOVE}: ${business}`,
  );

  useEffect(() => {
    if (!open) return;
    setStage("input");
    setRaw("");
    setDomain("");
    setError(null);
  }, [open]);

  function next() {
    const parsed = parseDomainInput(raw, new Set(platformHosts));
    if (!parsed.ok) {
      setError(
        parsed.code === "subdomain"
          ? C.subdomain
          : parsed.code === "reserved"
            ? C.reserved
            : C.invalid,
      );
      return;
    }
    if (parsed.domain === currentDomain.toLowerCase()) {
      setError(C.same);
      return;
    }
    setError(null);
    setDomain(parsed.domain);
    setStage("case");
  }

  return (
    <>
      <Dialog
        open={open && stage === "input"}
        onClose={onClose}
        title={P14_COPY.BTN_MOVE_DOMAIN}
        footer={
          <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
            <Button
              variant="secondary"
              onClick={onClose}
              className="max-sm:w-full"
            >
              {C.notNow}
            </Button>
            <Button
              variant="primary"
              onClick={next}
              disabled={raw.trim() === ""}
              className="max-sm:w-full"
            >
              {C.next}
            </Button>
          </div>
        }
      >
        <form
          className="flex flex-col gap-3 font-hub"
          onSubmit={(e) => {
            e.preventDefault();
            next();
          }}
        >
          <TextField
            id={`${id}-domain`}
            label={C.newDomain}
            value={raw}
            autoComplete="off"
            spellCheck={false}
            inputMode="url"
            error={error ?? undefined}
            onChange={(e) => {
              setRaw(e.currentTarget.value);
              setError(null);
            }}
          />
          <p className="text-sm text-hub-ink-muted">
            {C.consequence(currentDomain)}
          </p>
        </form>
      </Dialog>
      <CaseDialog
        open={open && stage === "case"}
        onClose={onClose}
        safeFocus
        title={C.title(business, domain)}
        consequence={C.lines(currentDomain, domain)}
        caseRows={[
          [T.site, business],
          [T.domain, `${currentDomain} → ${domain}`],
        ]}
        reasonField={{
          label: T.reason,
          helper: T.reasonHelper,
          min: 10,
          max: 500,
        }}
        confirmLabel={P14_COPY.BTN_START_MOVE}
        safeLabel={P14_COPY.BTN_NOT_NOW}
        onConfirm={(values) =>
          run(orgId, { domain, reason: values.reason ?? "" })
        }
      />
    </>
  );
}

export interface MoveDomainButtonProps extends Omit<
  MoveDomainDialogProps,
  "open" | "onClose"
> {
  canSuper: boolean;
  /** Only live sites with a custom domain can move (P14-P38). */
  live: boolean;
}

export function MoveDomainButton({
  canSuper,
  live,
  ...dialog
}: MoveDomainButtonProps) {
  const [open, setOpen] = useState(false);
  if (!live) return null;
  const icon = <ArrowRightLeft aria-hidden size={16} strokeWidth={2} />;
  if (!canSuper) {
    return <SuperOnly label={P14_COPY.BTN_MOVE_DOMAIN} icon={icon} />;
  }
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        icon={icon}
        onClick={() => setOpen(true)}
      >
        {P14_COPY.BTN_MOVE_DOMAIN}
      </Button>
      <MoveDomainDialog
        {...dialog}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

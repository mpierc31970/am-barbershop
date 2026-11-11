"use client";
// Small shared pieces for the staff domain components (14-38). Internal: not in the barrel.
// - SuperOnly: a super_admin action a support_agent sees disabled with "Super Admin only"
//   beside it (P13 SiteActions pattern; T-14-38-02: the server refuses regardless).
// - useDomainRun: runs one staff server action through useStaffAction (step-up retry,
//   session end), toasts the ok message, returns the failure message for inline display.
import { P14_COPY } from "@cds/core/dns";
import { useId, useState, type ReactNode } from "react";
import { Button } from "../../hub/Button";
import { useToast } from "../../hub/Toast";
import { useStaffAction, type StaffActionResult } from "../dialogs";

export function SuperOnly({
  label,
  icon,
}: {
  label: string;
  icon?: ReactNode;
}) {
  const id = useId();
  return (
    <span
      className="inline-flex flex-wrap items-center gap-2"
      data-super-only=""
    >
      <Button
        size="sm"
        variant="secondary"
        disabled
        icon={icon}
        aria-describedby={id}
      >
        {label}
      </Button>
      <span id={id} className="text-sm text-hub-ink-muted">
        {P14_COPY.SUPER_ONLY}
      </span>
    </span>
  );
}

export function useDomainRun<A extends unknown[]>(
  action: (...args: A) => Promise<StaffActionResult<{ message: string }>>,
  describe: string,
): {
  pending: boolean;
  run: (...args: A) => Promise<StaffActionResult<{ message: string }>>;
} {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const staffRun = useStaffAction(action, { describe: () => describe });
  async function run(
    ...args: A
  ): Promise<StaffActionResult<{ message: string }>> {
    setPending(true);
    try {
      const res = await staffRun(...args);
      if (res.ok) toast.show({ message: res.data.message });
      return res;
    } finally {
      setPending(false);
    }
  }
  return { pending, run };
}

/** A failure worth showing (a stopped step-up or an ended session says nothing). */
export function failureText(res: StaffActionResult<unknown>): string | null {
  if (res.ok) return null;
  if (res.code === "step_up_needed" || res.code === "session_ended")
    return null;
  return res.message;
}

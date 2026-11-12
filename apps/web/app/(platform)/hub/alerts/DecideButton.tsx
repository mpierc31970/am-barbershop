"use client";
// Approve / Decline submit button: busy ("Approving…") while its form's action runs, so a
// tap shows at once instead of the card sitting on "Waiting for you".
import { Button } from "@cds/ui/hub";
import { useFormStatus } from "react-dom";

export function DecideButton({
  to,
  label,
  busyLabel,
}: {
  to: string;
  label: string;
  busyLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={to === "confirmed" ? "primary" : "secondary"}
      loading={pending}
      loadingLabel={busyLabel}
    >
      {label}
    </Button>
  );
}

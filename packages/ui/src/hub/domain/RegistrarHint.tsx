// RegistrarHint (14-30 choice 3; 14-UI-SPEC "S1 · Checking"). Body "Registered at
// **GoDaddy**, in your name. Renews **3 Mar 2027**." once RDAP answers; with no answer the
// Label ink-muted RDAP-UNKNOWN line. Never blocks anything. The registrar arrives as its
// owner display name and the date pre-formatted by the caller. Server-safe.
import { P14_COPY } from "@cds/core/dns";
import { DOMAIN_UI_COPY as C } from "./copy";

export interface RegistrarHintProps {
  /** Owner display name ("GoDaddy"); null when RDAP gave no answer. */
  registrar: string | null;
  /** Renewal date, already formatted ("3 Mar 2027"); null when unknown. */
  renews: string | null;
}

export function RegistrarHint({ registrar, renews }: RegistrarHintProps) {
  if (!registrar) {
    return (
      <p
        data-registrar-hint="unknown"
        className="max-w-[68ch] font-hub text-sm text-hub-ink-muted"
      >
        {P14_COPY.RDAP_UNKNOWN}
      </p>
    );
  }
  return (
    <p
      data-registrar-hint=""
      className="max-w-[68ch] font-hub text-base text-hub-ink"
    >
      {C.registeredAt} <strong className="font-semibold">{registrar}</strong>
      {C.inYourName}
      {renews ? (
        <>
          {" "}
          {C.renews}{" "}
          <strong className="font-semibold tabular-nums">{renews}</strong>.
        </>
      ) : null}
    </p>
  );
}

"use client";
// PrimaryHostChoice (14-30 choice 3; 14-UI-SPEC "S5 · Connected", "S6 · Live"; P14-P16). A
// RadioCardGroup with the legend Your main address: riverabakery.com ("Recommended.
// www.riverabakery.com sends visitors here.") or www.riverabakery.com ("riverabakery.com
// sends visitors here."). Native radios, so the group has radio semantics and arrow keys.
// The caller saves on change (S5) or inside the Change your main address dialog (S6).
import { useId } from "react";
import { RadioCardGroup } from "../RadioCardGroup";
import { DOMAIN_UI_COPY as C } from "./copy";

export type PrimaryHost = "apex" | "www";

export interface PrimaryHostChoiceProps {
  domain: string;
  value: PrimaryHost;
  onChange(value: PrimaryHost): void;
}

export function PrimaryHostChoice({
  domain,
  value,
  onChange,
}: PrimaryHostChoiceProps) {
  const name = `primary-host-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <RadioCardGroup<PrimaryHost>
      name={name}
      legend={C.mainAddress}
      value={value}
      onChange={onChange}
      options={[
        {
          value: "apex",
          title: domain,
          description: C.apexDescription(domain),
        },
        {
          value: "www",
          title: `www.${domain}`,
          description: C.wwwDescription(domain),
        },
      ]}
    />
  );
}

"use client";
// NameserverPair (14-30 choice 3; 14-UI-SPEC "S3 · Change your nameservers", spacing
// "Nameserver rows"; D-UI-P14-7). Two 56px rows on surface-2, 16px padding-x, 8px radius,
// 8px apart: Label "Nameserver 1" + the value (font-mono, Label size, 600, selectable text,
// never an image) + a ghost sm CopyLinkButton "Copy" (accessible name "Copy nameserver 1";
// after a click Check + "Copied" for 2 s and the polite announcement "Copied nameserver 1").
// Used for CDS's pair (S3, S7, handback mismatch) and the owner's destination (handback).
import { useState } from "react";
import { CopyLinkButton } from "../social/SocialAccountsList";
import { DOMAIN_UI_COPY as C } from "./copy";

export interface NameserverPairProps {
  /** Names the list for assistive tech ("Nameservers", "CDS's nameservers"). */
  label?: string;
  values: readonly string[];
}

export function NameserverPair({ label, values }: NameserverPairProps) {
  const [announce, setAnnounce] = useState("");
  return (
    <div className="flex flex-col gap-2 font-hub text-hub-ink">
      <ul aria-label={label ?? C.nameservers} className="flex flex-col gap-2">
        {values.map((v, i) => {
          const n = i + 1;
          return (
            <li
              key={`${n}-${v}`}
              data-nameserver={n}
              className="flex min-h-14 flex-wrap items-center justify-between gap-2 rounded-lg bg-hub-surface-2 px-4 py-2"
            >
              <span className="flex min-w-0 flex-col">
                <span className="text-sm text-hub-ink-muted">
                  {C.nameserver(n)}
                </span>
                <span className="font-mono text-sm font-semibold [overflow-wrap:anywhere] select-all">
                  {v}
                </span>
              </span>
              <CopyLinkButton
                name={C.nameserver(n)}
                link={v}
                label={C.copy}
                accessibleName={C.copyNameserver(n)}
                copiedMessage={C.copiedNameserver(n)}
                variant="ghost"
                onCopied={setAnnounce}
              />
            </li>
          );
        })}
      </ul>
      <p aria-live="polite" className="sr-only" data-nameserver-live="">
        {announce}
      </p>
    </div>
  );
}

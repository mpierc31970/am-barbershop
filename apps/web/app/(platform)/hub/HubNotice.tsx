"use client";
// One-time hub notices carried in the URL (06-18; D286; 06-UI-SPEC "Submit" outcomes,
// Copywriting EXISTING-OWNER). Submit sends an existing owner to /hub?notice=existing-owner;
// /hub keeps the query through its stage redirect, and this island (mounted once in the
// HubShell content area) shows the info alert on that screen, then strips the param so a
// reload or a shared link never shows it again. Only a known notice value renders; anything
// else in the param is ignored (never echoed).
// 09-19 (AGR-07, CONTEXT A3-Q1, D-UI-P9-19): "terms-updated" carries MEMBER-OUTDATED. /hub
// adds it only for an Admin whose org's terms are outdated (the Owner is sent to re-accept;
// Editors and Viewers have no legal surface). It is information only: nobody is blocked.
import { InlineAlert } from "@cds/ui/hub";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  MEMBER_OUTDATED_COPY,
  TERMS_UPDATED_NOTICE,
} from "../../../lib/agreement-setup";

export const EXISTING_OWNER_COPY =
  "You already have a site with us, so we signed you in to it. We kept your new quote, and Support will be in touch about it.";

const NOTICES: Readonly<Record<string, string>> = Object.freeze({
  "existing-owner": EXISTING_OWNER_COPY,
  [TERMS_UPDATED_NOTICE]: MEMBER_OUTDATED_COPY,
  // 10-22: checkout of an already-paid order lands on Settings › Billing with this notice.
  "already-paid": "You've already paid. Your billing is here.",
});

function noticeCopy(value: string | null): string | null {
  if (value === null || !Object.hasOwn(NOTICES, value)) return null;
  return NOTICES[value] ?? null;
}

/** The same URL without the notice param (other params kept, in order). */
export function withoutNotice(
  pathname: string,
  params: URLSearchParams,
): string {
  const next = new URLSearchParams(params);
  next.delete("notice");
  const q = next.toString();
  return q ? `${pathname}?${q}` : pathname;
}

export function HubNotice() {
  const params = useSearchParams();
  const pathname = usePathname() ?? "";
  const router = useRouter();
  // Captured on the first render: the alert stays on this screen after the param is
  // stripped, and goes away once the owner moves to another hub screen.
  const [shown] = useState(() => ({
    copy: noticeCopy(params?.get("notice") ?? null),
    path: pathname,
  }));

  const hasParam = params?.has("notice") ?? false;
  useEffect(() => {
    if (!hasParam || !params) return;
    router.replace(withoutNotice(pathname, params), { scroll: false });
  }, [hasParam, params, pathname, router]);

  if (!shown.copy || shown.path !== pathname) return null;
  return (
    <div className="mb-6">
      <InlineAlert tone="info">{shown.copy}</InlineAlert>
    </div>
  );
}

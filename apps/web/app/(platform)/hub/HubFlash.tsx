"use client";
// One-time toasts after a redirect (11-50; closes the 11-11 / 11-38 / 11-39 gap). A server
// action that redirects into the hub adds `?flash=<kind>` (lib/flash.ts withFlash); this island
// (mounted once in the HubShell content area, beside HubNotice) shows the toast on arrival,
// then strips the param so a reload, Back or a shared link never shows it again. Only a known
// kind renders; anything else in the param is ignored and never echoed. The site name is the
// shell's own current business name (from the session), never taken from the URL.
import { useToast } from "@cds/ui/hub";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { FLASH_PARAM, flashCopy, withoutFlash } from "../../../lib/flash";

export function HubFlash({ businessName }: { businessName: string }) {
  const params = useSearchParams();
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const toast = useToast();
  const value = params?.get(FLASH_PARAM) ?? null;
  // One toast per arrival, even when the effect runs twice (dev strict mode).
  const shownFor = useRef<string | null>(null);

  useEffect(() => {
    if (value === null || !params) return;
    const key = `${pathname}|${value}`;
    if (shownFor.current !== key) {
      shownFor.current = key;
      const copy = flashCopy(value, businessName);
      if (copy) toast.show({ message: copy });
    }
    router.replace(withoutFlash(pathname, params), { scroll: false });
  }, [value, params, pathname, router, toast, businessName]);

  return null;
}

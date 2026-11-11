"use client";
// A next/link that asks the hub navigation guard before it leaves (03-UI-REVIEW Fix 4,
// WR-B05). In-hub links that swap the screen (Website tabs, the pop-up list, "All pop-ups")
// use it, so a screen with unsaved edits (the pop-up editor, the builder) gets its "Save
// changes?" dialog instead of silently dropping the edits. A modifier or middle click opens
// a new tab, so it is left alone (IN-R05).
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { guardLinkClick, useNavGuard } from "./nav-guard";

export type GuardedLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
};

export function GuardedLink({ href, onClick, ...rest }: GuardedLinkProps) {
  const router = useRouter();
  const navGuard = useNavGuard();
  return (
    <Link
      href={href}
      {...rest}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        guardLinkClick(e, navGuard, () => router.push(href));
      }}
    />
  );
}

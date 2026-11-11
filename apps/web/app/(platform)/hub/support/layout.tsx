// A&M fork: no CDS Support on this site (CDS does not support it), for any role: every
// /hub/support/** page answers not found, and the sidebar has no Support item (nav.ts).
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

export default function SupportLayout({ children }: { children: ReactNode }) {
  notFound();
  return children;
}

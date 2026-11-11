// The page-title H1 band (CONT-13, CONT-35, D280; 07-UI-SPEC "Page title header" line 368,
// D-UI-P7-13).
//
// A page without a Hero still gets exactly one visible H1: its title, in a band on the
// theme surface, inside the 1120px container, at --site-text-display (600, balanced
// wrap), padding-y 48px mobile / 64px desktop (RowRenderer's py-12 md:py-16). PageRenderer
// renders it whenever no Hero owns the H1. The 404 (07-32) and search (07-31) pages reuse
// it. The title is a React text child (escaped), never raw HTML (T-07-05-01). Only
// --site-* roles. Server component: no hooks, no next/* imports.
import type { BackgroundVariant } from "@cds/core/content";
import { RowRenderer } from "./RowRenderer";
import { HEADING_CLASSES } from "./types";
import { text } from "./urls";

export interface PageTitleHeaderProps {
  title: string;
  background?: BackgroundVariant;
}

export function PageTitleHeader({
  title,
  background = "main",
}: PageTitleHeaderProps) {
  return (
    <RowRenderer layout="full" background={background}>
      <h1 data-page-title="" className={HEADING_CLASSES[1] + " text-balance"}>
        {text(title)}
      </h1>
    </RowRenderer>
  );
}

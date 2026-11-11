"use client";
// Help opener context (11-47; DASH-17, D-UI-P11-16). The hub shell's HelpDrawerHost provides
// a function that opens the TrainingDrawer for a help id (it sets `?help=<id>` on the current
// URL). ScreenHeader's "?" stays a link to /hub/help/<id> (no-JS path); with an opener in
// context a plain left click opens the drawer in place instead. No provider = plain link.
import { createContext, useContext } from "react";

export type HelpOpener = (helpId: string) => void;

export const HelpOpenerContext = createContext<HelpOpener | null>(null);

export function useHelpOpener(): HelpOpener | null {
  return useContext(HelpOpenerContext);
}

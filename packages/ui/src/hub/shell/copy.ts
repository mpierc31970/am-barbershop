// Hub shell copy (11-15; 11-UI-SPEC "Header", "Org switcher", "Jump to", "NotLiveYet",
// "Help", Copywriting Contract: NOTLIVE-BODY, JUMP-EMPTY, ERR-SWITCH verbatim). Owner words
// only: "site", never "organization" (Voice).
export const SHELL_COPY = Object.freeze({
  skipToContent: "Skip to content",
  openMenu: "Open menu",
  /** Accessible name of the switcher trigger. */
  switchName: (site: string) => `Switch site, current: ${site}`,
  switcherListLabel: "Your sites",
  switching: "Switching…",
  /** ERR-SWITCH (toast; the app shows it when the switch action fails). */
  errSwitch: "We couldn't switch sites just now. Try again in a minute.",
  jumpButtonName: "Jump to a screen or help article",
  jumpButtonText: "Jump to…",
  jumpIconLabel: "Jump to",
  jumpKeysWindows: "Ctrl K",
  jumpKeysMac: "⌘ K",
  jumpKeyshortcuts: "Control+K Meta+K",
  jumpDialogTitle: "Jump to",
  jumpInputLabel: "Jump to",
  jumpPlaceholder: "Search screens and help",
  jumpGroupScreens: "Screens",
  jumpGroupHelp: "Help articles",
  jumpHelpPath: "Help",
  /** JUMP-EMPTY, split around its link. */
  jumpEmptyBefore: (query: string) =>
    `Nothing matches "${query}". Try a shorter word, or `,
  jumpEmptyLink: "open the Help center",
  jumpEmptyAfter: ".",
  jumpHelpCenterHref: "/hub/help",
  jumpCount: (n: number) =>
    n === 0 ? "No results" : n === 1 ? "1 result" : `${n} results`,
  viewSite: "View site",
  profileButton: "Your profile and sign out",
  profileLink: "Your profile and alerts",
  profileHref: "/hub/profile",
  signOut: "Sign out",
  /** "?" beside every screen's H1 (D-UI-P11-16). */
  helpFor: (screen: string) => `How ${screen} works`,
  helpHref: (helpId: string) => `/hub/help/${encodeURIComponent(helpId)}`,
  notLiveHeading: "Starts when you go live",
  /** NOTLIVE-BODY */
  notLiveBody:
    "Nothing here goes out to customers until your site is live. You can set it up now.",
});

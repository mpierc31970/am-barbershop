// Help center and article copy (11-46; 11-UI-SPEC "Help" lines 592-610, HELP-EMPTY verbatim).
export const HELP_COPY = Object.freeze({
  title: "Help",
  searchLabel: "Search help",
  /** Polite live line under the search box. */
  count: (n: number) => (n === 1 ? "1 article" : `${n} articles`),
  /** HELP-EMPTY, split around its link. */
  emptyBefore: (query: string) =>
    `No help articles match "${query}". Try another word, or `,
  /** Nothing to list and no search typed (review 11 IN-D05); shares the link and ending. */
  noneBefore: "No help articles here yet. For anything you need, ",
  emptyLink: "ask Support",
  emptyAfter: ".",
  askSupport: "Ask Support",
  footerBefore: "Can't find it? ",
  footerAfter: ".",
  /** 12-20: the Get help form (no target), same as the drawer's "Still stuck? Ask CDS". */
  supportHref: "/hub/support/tickets/new",
  helpHref: "/hub/help",
  back: "Help",
  activate: "Turn it on",
  use: "Use it",
  goTo: (screen: string) => `Go to ${screen}`,
});

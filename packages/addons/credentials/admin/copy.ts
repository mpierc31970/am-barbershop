// Every owner-facing string of the Credentials tab, drawer and block form (05-UI-SPEC
// "Credentials tab", "Delete a record", "Builder integration", "Copywriting Contract").
// Owner words only: never "install", "record", "entitlement" or "sync".

export const TAB = {
  heading: "Credentials",
  help: "How Credentials works",
  add: "Add credential",
  exportCsv: "Export CSV",
  template: "Download the template",
  backups: "Backups",
  importTitle: "Import credentials",
  listLabel: "Your credentials",
  noun: "credential",
} as const;

export function countLine(total: number, shown: number): string {
  const noun = total === 1 ? "credential" : "credentials";
  return `${total} ${noun} · ${shown} shown on your site`;
}

export const PAGE_LINE = {
  prefix: "Your Credentials page:",
  view: "View",
  viewLabel: "View Credentials page",
  navAdd: "Add to navigation",
  navIn: "In your menu",
  navArrange: "Arrange",
  navArrangeHref: "/hub/website?tab=navigation",
  deleted:
    "Your Credentials page was deleted. Place the Credentials block on any page from the page builder.",
  deletedLink: "Go to Pages",
} as const;

/** Toast after the seeded page joins the site menu (07-25). */
export function navAdded(name: string): string {
  return `${name} page added to your menu.`;
}

export function heldNotice(count: number): string {
  return count === 1
    ? "1 credential is being reviewed, usually within 2 business days. It shows on your site once cleared."
    : `${count} credentials are being reviewed, usually within 2 business days. They show on your site once cleared.`;
}

export const NOTHING_SHOWN =
  'None of your credentials are shown on your site yet. Turn on "Show on site" for the ones you want visitors to see.';

export const EXPIRING = {
  lead: (n: number) =>
    n === 1
      ? "1 credential expires in the next 60 days:"
      : `${n} credentials expire in the next 60 days:`,
  tail: "Update the dates once you renew.",
  openLabel: (title: string) => `Edit ${title}`,
} as const;

export const EMPTY = {
  heading: "No credentials yet",
  body: "List your licenses, certifications and memberships. Visitors see them grouped on your Credentials page, and expired ones hide automatically.",
  add: "Add your first credential",
  import: "Import from a spreadsheet",
  how: "How this works",
  helper: "Keeping a list in Excel already? Import it with our template.",
} as const;

export const ROW = {
  showOnSite: "Show on site",
  showOnSiteLabel: (title: string) => `Show ${title} on site`,
  moreLabel: (title: string) => `More actions for ${title}`,
  menuLabel: (title: string) => `Actions for ${title}`,
  edit: "Edit",
  moveUp: "Move up",
  moveDown: "Move down",
  delete: "Delete credential",
  inReview: "In review",
  hidden: "Hidden",
  expiresSoon: (date: string) => `Expires soon · ${date}`,
  expired: "Expired · hidden on site",
  number: (n: string) => `No. ${n}`,
  validThrough: (date: string) => `Valid through ${date}`,
  issued: (year: string) => `Issued ${year}`,
} as const;

export const DELETE = {
  title: (title: string) => `Delete ${title}?`,
  body: "It disappears from your site right away. To keep it but stop showing it, turn off Show on site instead.",
  confirm: "Delete credential",
  keep: "Keep credential",
  done: "Credential deleted.",
} as const;

export const TOAST = {
  saved: "Credential saved.",
  held: "Saved. It shows on your site once it's reviewed, usually within 2 business days.",
  toggleFailed: "That change didn't save. Try again.",
  reorderFailed:
    "That move didn't save, so the credential went back. Try again.",
  exported: (n: number) =>
    `Exported ${n} ${n === 1 ? "credential" : "credentials"}.`,
  imported: (added: number, updated: number) =>
    `Imported. ${added} added, ${updated} updated. A backup was saved first.`,
  undoImport: "Undo import",
  importUndone: "Import undone. Your list is back to how it was.",
  undoFailed: "The restore didn't finish, so nothing changed. Try again.",
} as const;

export const ERR_SAVE =
  "Your changes weren't saved. Try again; if it keeps failing, copy your text somewhere safe first.";

export const DRAWER = {
  newTitle: "New credential",
  editTitle: "Edit credential",
  close: "Close",
  title: "Title",
  titleHelper: "Like 'Registered Nurse'",
  issuer: "Issued by",
  issuerHelper: "Like 'Texas Board of Nursing'",
  group: "Group",
  groupHelper:
    "Credentials with the same group show together, like Licenses or Memberships.",
  number: "Number",
  showNumber: "Show number on site",
  issued: "Issued",
  expires: "Expires",
  expiresHelper:
    "Leave empty if it doesn't expire. Expired credentials hide from your site automatically.",
  verify: "Verify link",
  verifyHelper:
    "A page where visitors can check it, like the board's license lookup.",
  showOnSite: "Show on site",
  save: "Save credential",
  saving: "Saving…",
  discard: "Discard changes",
  needsAttention: (n: number) =>
    n === 1 ? "1 field needs attention" : `${n} fields need attention`,
  guardTitle: "Save changes to this credential?",
  guardBody: "You have changes that aren't saved yet.",
  guardSave: "Save and close",
  guardDiscard: "Discard changes",
  guardKeep: "Keep editing",
} as const;

export const BLOCK_FORM = {
  editPrefix: "Edit your credentials in",
  editLink: "Website → Credentials",
  heading: "Heading",
  groupByCategory: "Group by category",
  groupHelper:
    "On: each group gets its own heading, like Licenses. Off: one list.",
} as const;

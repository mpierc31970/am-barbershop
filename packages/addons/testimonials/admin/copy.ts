// Every owner-facing string of the Testimonials tab, drawer and block form (05-UI-SPEC
// "Testimonials tab", "Delete a record", "Builder integration", "Copywriting Contract").
// Owner words only: never "install", "record", "entitlement" or "sync".

export const TAB = {
  heading: "Testimonials",
  help: "How Testimonials works",
  add: "Add testimonial",
  exportCsv: "Export CSV",
  template: "Download the template",
  backups: "Backups",
  importTitle: "Import testimonials",
  listLabel: "Your testimonials",
  noun: "testimonial",
} as const;

export function countLine(total: number, shown: number): string {
  const noun = total === 1 ? "testimonial" : "testimonials";
  return `${total} ${noun} · ${shown} shown on your site`;
}

export const PAGE_LINE = {
  prefix: "Your Testimonials page:",
  view: "View",
  viewLabel: "View Testimonials page",
  navAdd: "Add to navigation",
  navIn: "In your menu",
  navArrange: "Arrange",
  navArrangeHref: "/hub/website?tab=navigation",
  deleted:
    "Your Testimonials page was deleted. Place the Testimonials block on any page from the page builder.",
  deletedLink: "Go to Pages",
} as const;

/** Toast after the seeded page joins the site menu (07-25). */
export function navAdded(name: string): string {
  return `${name} page added to your menu.`;
}

export function heldNotice(count: number): string {
  return count === 1
    ? "1 testimonial is being reviewed, usually within 2 business days. It shows on your site once cleared."
    : `${count} testimonials are being reviewed, usually within 2 business days. They show on your site once cleared.`;
}

export const NOTHING_SHOWN =
  'None of your testimonials are shown on your site yet. Turn on "Show on site" for the ones you want visitors to see.';

export const EMPTY = {
  heading: "No testimonials yet",
  body: "Add the kind words customers have sent you. They show on your Testimonials page and anywhere you place the Testimonials block.",
  add: "Add your first testimonial",
  import: "Import from a spreadsheet",
  how: "How this works",
  helper:
    "Have them in a Google Doc or email? Paste them into our template and import them all at once.",
} as const;

export const ROW = {
  featureLabel: (name: string) => `Feature testimonial from ${name}`,
  showOnSite: "Show on site",
  showOnSiteLabel: (name: string) => `Show testimonial from ${name} on site`,
  moreLabel: (name: string) => `More actions for testimonial from ${name}`,
  menuLabel: (name: string) => `Actions for testimonial from ${name}`,
  edit: "Edit",
  moveUp: "Move up",
  moveDown: "Move down",
  delete: "Delete testimonial",
  inReview: "In review",
  hidden: "Hidden",
  rating: (n: number) => `${n} of 5`,
} as const;

export const DELETE = {
  title: (name: string) => `Delete the testimonial from ${name}?`,
  body: "It disappears from your site right away. To keep it but stop showing it, turn off Show on site instead.",
  confirm: "Delete testimonial",
  keep: "Keep testimonial",
  done: "Testimonial deleted.",
} as const;

export const TOAST = {
  saved: "Testimonial saved.",
  held: "Saved. It shows on your site once it's reviewed, usually within 2 business days.",
  toggleFailed: "That change didn't save. Try again.",
  reorderFailed:
    "That move didn't save, so the testimonial went back. Try again.",
  exported: (n: number) =>
    `Exported ${n} ${n === 1 ? "testimonial" : "testimonials"}.`,
  imported: (added: number, updated: number) =>
    `Imported. ${added} added, ${updated} updated. A backup was saved first.`,
  undoImport: "Undo import",
  importUndone: "Import undone. Your list is back to how it was.",
  undoFailed: "The restore didn't finish, so nothing changed. Try again.",
} as const;

export const ERR_SAVE =
  "Your changes weren't saved. Try again; if it keeps failing, copy your text somewhere safe first.";

export const DRAWER = {
  newTitle: "New testimonial",
  editTitle: "Edit testimonial",
  close: "Close",
  quote: "Quote",
  name: "Name",
  nameHelper: "As they'd like it shown, like 'Maria L.'",
  about: "About them",
  aboutHelper: "Role or town, like 'Owner, Rivera Bakery'",
  rating: "Rating",
  noRating: "No rating",
  stars: (n: number) => `${n} stars`,
  photo: "Photo link",
  photoHelper: "Photo upload arrives later. For now, paste a link to an image.",
  photoAlt: "Photo description",
  photoAltHelper: "Describe the photo for people who can't see it.",
  featured: "Featured",
  featuredHelper:
    "Featured testimonials show first, and a block can show only these.",
  showOnSite: "Show on site",
  save: "Save testimonial",
  saving: "Saving…",
  discard: "Discard changes",
  needsAttention: (n: number) =>
    n === 1 ? "1 field needs attention" : `${n} fields need attention`,
  guardTitle: "Save changes to this testimonial?",
  guardBody: "You have changes that aren't saved yet.",
  guardSave: "Save and close",
  guardDiscard: "Discard changes",
  guardKeep: "Keep editing",
} as const;

export const BLOCK_FORM = {
  editPrefix: "Edit your testimonials in",
  editLink: "Website → Testimonials",
  heading: "Heading",
  layout: "Layout",
  grid: "Grid",
  gridDescription: "Several quotes side by side.",
  single: "One quote",
  singleDescription: "One quote, centered.",
  show: "Show",
  showAll: "All shown testimonials",
  showFeatured: "Featured only",
  howMany: "How many",
  howManyHelper: "From 1 to 12.",
  singleHelper:
    "One quote shows your first featured testimonial, or your first one if none are featured.",
} as const;

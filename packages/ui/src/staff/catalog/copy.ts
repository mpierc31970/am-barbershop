// Catalog copy (13-37; STAFF-07; 13-UI-SPEC "Catalog" lines 834-872, price dialog line 1079).
// Shared by the @cds/ui/staff/catalog components and the apps/web catalog islands. P13_COPY
// (SUPER-ONLY, REFUSED-ROLE, UNDO) and P13_DIALOGS.price_save stay in @cds/core/staff.

export const CATALOG_COPY = {
  // Add-ons tab
  addonsCaption: "Add-on listings, in the order owners see them",
  behaviourNote:
    "Copy, screenshots and availability only. What the add-on does comes from its package.",
  cols: {
    addon: "Add-on",
    availability: "Availability",
    visibility: "Visibility",
    tagline: "Tagline",
    screenshots: "Screenshots",
    updated: "Updated",
    sort: "Sort",
    move: "Order",
  },
  availability: {
    available: "Available",
    coming_soon: "Coming soon",
    hidden: "Hidden",
  },
  visibility: { public: "Public", private: "Private" },
  alwaysPrivate: "Always private",
  moveUp: "Move up",
  moveDown: "Move down",
  moveUpLabel: (name: string) => `Move ${name} up`,
  moveDownLabel: (name: string) => `Move ${name} down`,
  editListing: (name: string) => `Edit ${name} listing`,
  updatedBy: (when: string, by: string | null) =>
    by ? `${when} by ${by}` : when,
  never: "Not edited",
  // Listing editor
  backToList: "All add-ons",
  tagline: "Tagline",
  description: "Description",
  defaultPlaceholder: (summary: string) => `Default: ${summary}`,
  resetToDefault: "Reset to default",
  availabilityLegend: "Availability",
  availabilityHelp: {
    available: "Owners and visitors can pick it.",
    coming_soon: "Listed with a Coming soon badge; nobody can add it yet.",
    hidden: "Not listed anywhere. Sites that have it keep it.",
  },
  privateHelp: "Private add-ons are never listed, whatever is set here.",
  ownersSee: "Owners see",
  saveListing: "Save listing",
  discardChanges: "Discard changes",
  saved: "Saved. /start and the hub show the new listing.",
  tooLong: (max: number) =>
    `Keep it to ${max.toLocaleString("en-US")} characters.`,
  // Screenshots
  screenshots: "Screenshots",
  screenshotsHelp: (max: number) =>
    `PNG, JPEG or WebP, up to 2 MB each, up to ${max}. Shown in this order.`,
  chooseImage: "Choose image",
  altText: "Alt text",
  altRequired: "Describe the screenshot for people who can't see it.",
  upload: "Upload",
  uploading: "Uploading…",
  cancel: "Cancel",
  remove: "Remove",
  removeLabel: (n: number) => `Remove screenshot ${n}`,
  moveShotUpLabel: (n: number) => `Move screenshot ${n} up`,
  moveShotDownLabel: (n: number) => `Move screenshot ${n} down`,
  removed: "Screenshot removed.",
  /** WR-D02: Undo pressed after the remove was already sent. Upload it again to restore. */
  removedAlready:
    "That screenshot was already removed. Upload it again to put it back.",
  full: (max: number) =>
    `This add-on has ${max} screenshots. Remove one to add another.`,
  tooBig: "Screenshots must be 2 MB or smaller.",
  wrongType: "Use a PNG, JPEG or WebP image.",
  noScreenshots: "No screenshots yet.",
  // Prices tab
  pricesCaption: "Price catalog by kind, key and path",
  priceCols: {
    key: "Key",
    standard: "Standard",
    studio: "Studio",
    provider: "Provider price",
  },
  synced: "Synced",
  missing: "Missing",
  notOffered: "Not offered",
  noPrice: "—",
  editPriceLabel: (key: string, path: string) => `Edit ${key} ${path} price`,
  amount: "Amount",
  amountHelp: "Dollars and cents, like 19.00.",
  amountBad: "Enter an amount from $0.00 to $100,000.00, like 19.00.",
  comingSoonSwitch: "Price coming soon",
  previewPrice: "Preview price",
  oldNew: (oldText: string, newText: string) =>
    `Old → new: ${oldText} → ${newText}`,
  providerRow: "Provider price",
  providerLine: "A new provider price is created; the old one is archived.",
  providerSame: "No new provider price is needed.",
  sitesRow: "Sites",
  toFreeLine: (label: string, path: string, n: number) =>
    `This makes ${label} included free for every ${path} site (${n} ${n === 1 ? "site" : "sites"}).`,
  fromFreeLine: (label: string, path: string, n: number) =>
    `This ends ${label} being included free for every ${path} site (${n} ${n === 1 ? "site" : "sites"}); sites that have not installed it lose it.`,
  sitesChecked: "I've checked these sites",
  // Announcement tab
  annTitle: "Title",
  annBody: "Body",
  annLink: "Link",
  annLinkHelp: "Optional. https://… or a /hub/ path.",
  annPaths: "Paths",
  annPathsHelp: "Leave both unticked to show it on every path.",
  annDays: "Days",
  annDaysOptions: [
    { value: "7", label: "7 days" },
    { value: "14", label: "14 days" },
    { value: "30", label: "30 days" },
  ],
  setAnnouncement: "Set announcement",
  endAnnouncement: "End announcement",
  replaceTitle: "Replace the current announcement?",
  replaceBody: "Owners stop seeing the current one and see this instead.",
  replaceConfirm: "Replace it",
  replaceSafe: "Keep current",
  annSet: "Announcement live. Owners see it in From CDS.",
  annEnded: "Announcement ended. From CDS shows no announcement now.",
  annEmpty: "No announcement is showing.",
  annCurrent: "Showing now",
  annUntil: (when: string) => `Until ${when}`,
  annOpenEnded: "No end date",
  annEveryPath: "Every path",
  annPreview: "Owners see",
} as const;

// The "Use" steps of docs/how-to/contacts.md, baked for the hub (07-16; D110, CONTACTS-01).
// "How Contacts works" on Marketing › Contacts opens them in the P5 TrainingDrawer, the same
// way add-on training shows its baked how-to steps (the standalone bundle ships without
// docs/). A drift test (apps/web/test/contacts-tab.test.tsx) parses the how-to with the
// add-on generator's parseUseSteps and fails when these differ. Pure.
import type { HowToStepView } from "@cds/ui/hub";

export const CONTACTS_HOWTO = "docs/how-to/contacts.md";

export const CONTACTS_TITLE = "How Contacts works";

export const CONTACTS_STEPS: readonly HowToStepView[] = Object.freeze([
  {
    screen: "Marketing › Contacts",
    action:
      'Type "maria" in the search box ("Search name, email or phone") and pause',
    expected:
      'After a moment the table shows only contacts whose name, email or phone contains "maria", and the address bar keeps q=maria',
  },
  {
    screen: "Marketing › Contacts",
    action: "Choose Subscribed in the Newsletter filter",
    expected:
      "Only contacts with a green Subscribed badge are listed and Clear filters appears. Click Clear filters to see everyone again",
  },
  {
    screen: "Marketing › Contacts",
    action: "Click a contact's name, for example Maria Lopez",
    expected:
      'A drawer titled "Maria Lopez" opens on the right with Name, Email, Phone and Tags, a Newsletter line, History (newest first) and Notes',
  },
  {
    screen: "Contact drawer",
    action: 'In Tags, type "VIP" and press Enter, then click Save contact',
    expected:
      'A VIP chip appears, a toast reads "Contact saved." and the row shows the tag',
  },
  {
    screen: "Contact drawer, Notes",
    action: 'Type "Prefers morning calls" in Add a note and click Add note',
    expected:
      'The note appears at the top of the notes with "You" and today\'s date, and a toast reads "Note added."',
  },
  {
    screen: "Contact drawer, Newsletter",
    action:
      'On a contact whose line starts "Not confirmed" or "Subscribed", click Mark as unsubscribed, then Mark as unsubscribed in the dialog',
    expected:
      'The dialog closes, a toast reads "Marked as unsubscribed." and the line now starts "Unsubscribed" with the date. There is no button to subscribe someone',
  },
  {
    screen: "Marketing › Contacts",
    action:
      'Click Add contact, type Email "ana@example.com" and Name "Ana Ruiz", click Save contact',
    expected:
      'The drawer titled "Add contact" shows the note "To add people to your newsletter, they need to agree themselves, on a form or through the Newsletter add-on." After saving, a toast reads "Contact saved." and Ana Ruiz is in the list',
  },
  {
    screen: "Marketing › Contacts",
    action:
      'Click Import, drop a CSV exported from Mailchimp, Square or Google Contacts, match any unknown columns under Goes to (one must be Email), click Next: check rows, type "Spring fair 2026" in Tag everyone in this file, then click Import N contacts',
    expected:
      'The check step shows counts like "12 new · 30 updated" and "3 merged by email". The dialog closes and a toast reads "Imported. 12 added, 30 updated." Nobody is removed and no newsletter choice changes',
  },
  {
    screen: "Marketing › Contacts",
    action: "Open the More actions for Contacts menu and click Export CSV",
    expected:
      "A file named contacts.csv downloads with Name, Email, Phone, Tags, Newsletter, Source, Last activity and Added columns",
  },
  {
    screen: "Contact drawer",
    action:
      "Open More actions for Ana Ruiz, click Delete contact, then Delete contact in the dialog",
    expected:
      'The dialog reads "Delete Ana Ruiz?" and "Their details, notes and history are removed. Messages they sent stay in your Inbox." with Keep contact focused. After deleting, the drawer closes and a toast reads "Contact deleted."',
  },
]);

// The "Use" steps of docs/how-to/inbox.md, baked for the hub (07-19; D110, CONT-25).
// "How the Inbox works" on /hub/inbox opens them in the P5 TrainingDrawer, the same way
// add-on training shows its baked how-to steps (the standalone bundle ships without docs/).
// A drift test (apps/web/test/inbox-page.test.tsx) parses the how-to with the add-on
// generator's parseUseSteps and fails when these differ. Pure.
import type { HowToStepView } from "@cds/ui/hub";

export const INBOX_HOWTO = "docs/how-to/inbox.md";

export const INBOX_TITLE = "How the Inbox works";

export const INBOX_STEPS: readonly HowToStepView[] = Object.freeze([
  {
    screen: "Your published page",
    action:
      'Fill in the form (for example Name "Maria Lopez", Email "maria@example.com", a message) and click the form\'s button',
    expected:
      'The button reads "Sending…", then the form is replaced by your thank-you message with a green tick',
  },
  {
    screen: "Hub sidebar",
    action: "Look at Inbox in the sidebar",
    expected: "Inbox shows a count of unread messages, for example 1",
  },
  {
    screen: "Inbox, Messages tab",
    action: "Look at the newest row",
    expected:
      'Maria Lopez is at the top in bold with an Unread badge, the form name, the first words of her message and "Today" with the time',
  },
  {
    screen: "Inbox, Messages tab",
    action: "Click Maria Lopez",
    expected:
      'A drawer titled "Message from Maria Lopez" opens on the right with the form, page and time, then every answer. The Unread badge goes and the sidebar count drops',
  },
  {
    screen: "Message drawer",
    action: "Click Reply by email",
    expected:
      'Your mail app opens a new email to maria@example.com with the subject "Re: your message to" and your site\'s name',
  },
  {
    screen: "Message drawer",
    action: "Click View contact",
    expected:
      'Marketing › Contacts opens on Maria Lopez. If she ticked the newsletter box, the drawer showed "Newsletter: Agreed" and her contact reads "Not confirmed" until she confirms by email',
  },
  {
    screen: "Inbox toolbar",
    action:
      'Choose one form in the Form list, then type "cake" in the search box ("Search messages") and pause',
    expected:
      'Only that form\'s messages containing "cake" are listed, and the address bar keeps form= and q=cake',
  },
  {
    screen: "Inbox toolbar",
    action: "With one form chosen, click Export CSV",
    expected:
      'A file named after the form, like contact-messages-2026-09-12.csv, downloads with one row per message and one column per question. With All forms chosen the button is greyed out and says "Choose a form to export its messages."',
  },
  {
    screen: "Inbox, Filtered tab",
    action: "Click Filtered, open a message, then click Not spam",
    expected:
      'A toast reads "Moved to Messages.", the drawer closes and the message now shows on the Messages tab',
  },
  {
    screen: "Message drawer",
    action: "Open More actions for the message and click Mark as unread",
    expected:
      'A toast reads "Marked as unread.", the drawer closes and the row is bold with Unread again',
  },
  {
    screen: "Message drawer",
    action:
      "Open More actions, click Delete message, then Delete message in the dialog",
    expected:
      'The dialog reads "Delete this message from Maria Lopez?" and "It\'s removed from your Inbox for good. The contact stays in Contacts." with Keep message focused. After deleting, the drawer closes and a toast reads "Message deleted."',
  },
  {
    screen: "Your published page, JavaScript off",
    action:
      "Turn JavaScript off in the browser, fill in the form and click its button",
    expected:
      "The page reloads at the form and shows the same thank-you message. A missing answer comes back as a box listing what to fix, linked to each field",
  },
]);

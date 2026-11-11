// The "Use" steps of docs/how-to/forms.md and docs/how-to/item-button.md, baked for the hub
// (07-18; D110, CONT-25, choice 9). The Forms list's how-to button and the health tip's "Add an
// External form button" open them in the P5 TrainingDrawer, the same way add-on training shows
// its baked how-to steps (the standalone bundle ships without docs/). Drift tests
// (apps/web/test/forms-tab.test.tsx) parse the how-tos with the add-on generator's
// parseUseSteps and fail when these differ. Pure.
import { EXTERNAL_FORM_INTRO, type HowToStepView } from "@cds/ui/hub";

export const FORMS_HOWTO = "docs/how-to/forms.md";
export const FORMS_TITLE = "How Forms works";
export const ITEM_BUTTON_HOWTO = "docs/how-to/item-button.md";
export const EXTERNAL_FORM_TITLE = "Add an External form button";

export const FORMS_STEPS: readonly HowToStepView[] = Object.freeze([
  {
    screen: "`/hub/website?tab=forms`",
    action: "Click **Create form**, choose **Contact**, click **Create form**",
    expected:
      'A toast reads "Form created." and the form editor opens with Name, Email, Phone and Message',
  },
  {
    screen: "Form editor, header",
    action: 'Click the form name, type "Contact us", press **Enter**',
    expected:
      'The name changes. The helper under it reads "Only you see this name"',
  },
  {
    screen: "Form editor, field list",
    action:
      "Click **Add field**, then **Multiple choice**. In its settings click **Paste a list**, paste one option per line, click **Use this list**",
    expected:
      "A new field is selected with its options replaced by your list; blank and repeated lines are dropped",
  },
  {
    screen: "Field settings",
    action: "Turn on **Required**",
    expected:
      'The field row reads the type name followed by "· Required" and the preview drops "(optional)"',
  },
  {
    screen: "Field list",
    action: "Click **Move up** on a field (or drag it by its grip)",
    expected:
      'The field moves up one place and a screen reader hears "… dropped at position N of N."',
  },
  {
    screen: "Field settings",
    action: 'Type "Card number" as the **Label**',
    expected:
      'The field shows "Forms can\'t ask for card numbers, passwords or Social Security numbers. Change or remove this field." and **Save form** is disabled until you change it',
  },
  {
    screen: "**Form settings**",
    action:
      "Choose **Two columns**, then open a long field and turn on **Full width**",
    expected:
      "The preview shows two columns on wide screens and the field spans both",
  },
  {
    screen: "**Form settings**",
    action: 'Change **Button text**, for example to "Ask a question"',
    expected: 'The preview\'s button reads "Ask a question"',
  },
  {
    screen: "**Form settings**, **After sending**",
    action: "Choose **Go to a page** and pick a page",
    expected:
      "Visitors go to that page after sending instead of seeing a message",
  },
  {
    screen: "**Form settings**, **Send a copy to**",
    action:
      "Choose **Website inquiries**, **Newsletter** or **Your main address**",
    expected:
      'Each option shows the address it sends to. "Change addresses in Settings › Email" opens Settings',
  },
  {
    screen: "**Form settings**, **Newsletter sign-up**",
    action: "Turn on **Add a newsletter checkbox**",
    expected:
      'The wording field appears with "Send me news and offers by email. I can unsubscribe any time." and the helper says nothing is sent until you have the Newsletter add-on',
  },
  {
    screen: "Form editor, header",
    action: "Below 1280 px wide, click **Preview form**",
    expected:
      'The themed form shows with "Preview: sending is off"; wider screens always show it beside the settings',
  },
  {
    screen: "Form editor, header",
    action: "Click **Save form**",
    expected: 'A toast reads "Form saved. It\'s live on your site."',
  },
  {
    screen: "Form editor, header",
    action: "Save a form whose wording needs a check",
    expected:
      'A toast reads "Saved. The form shows on your site once it\'s reviewed, usually within 2 business days." and **In review** shows under the name',
  },
  {
    screen: "Field settings",
    action:
      'Type "Medication" as a label, then open **Form settings** and click **Add an External form button**',
    expected:
      'A tip reads "Forms aren\'t for health records. Use an External form button to your HIPAA service (IntakeQ, Jane, SimplePractice)." and a drawer explains how to add a Button item that links to your HIPAA form',
  },
  {
    screen: "`/hub/website?tab=forms`, row menu",
    action: "Click **Duplicate form**",
    expected:
      'A toast reads "Form duplicated." and the copy, named "Copy of …", opens',
  },
  {
    screen: "`/hub/website?tab=forms`, row menu",
    action: 'Click **View messages** (or the "N unread" link)',
    expected:
      "The Inbox opens at `/hub/inbox?form=<id>` showing that form's messages",
  },
  {
    screen: "`/hub/website?tab=forms`, row menu",
    action: "Click **Delete form**, then **Delete form** in the dialog",
    expected:
      'The dialog asks "Delete the Contact us form?". A toast reads "Form deleted." and the form leaves the list. A form a page or pop-up uses keeps working there and keeps taking messages; a form nothing uses is deleted for good. Either way its messages stay in your Inbox',
  },
]);

/** The item-button how-to's Use steps (drift-tested), after one intro step. */
export const ITEM_BUTTON_STEPS: readonly HowToStepView[] = Object.freeze([
  {
    screen: "Button item form",
    action: 'Fill **Button text**, for example "Book a visit"',
    expected: "—",
  },
  {
    screen: "Button item form, **Style**",
    action: "Choose **Primary** (filled) or **Secondary** (outlined)",
    expected: "The chosen card is selected",
  },
  {
    screen: "**When someone clicks it**",
    action:
      "Choose **Go to a link**, then fill **Link** with a page path like `/about` or a full address like `https://example.com`",
    expected:
      "A link that is not a page path or a web, email or phone address shows an error under the field",
  },
  {
    screen: "**When someone clicks it**",
    action: "Instead choose **Open a pop-up**, then pick one in **Pop-up**",
    expected:
      'If the site has no pop-ups yet, the form says "This site has no pop-ups yet." and a **Create a pop-up first** link to `/hub/website?tab=popups`. Saving with no pop-up chosen shows "Choose which pop-up this button opens."',
  },
  {
    screen: "Button item form",
    action: "Click **Save item**",
    expected:
      'The item row reads `Button · "Book a visit"`. The header reads **Draft saved · Unpublished changes**',
  },
  {
    screen: "Page header",
    action:
      "Click **Publish changes**, then open the page on your site and click the button",
    expected: "The link opens, or the chosen pop-up opens as a dialog",
  },
]);

export const EXTERNAL_FORM_STEPS: readonly HowToStepView[] = Object.freeze([
  {
    screen: "Your page in the builder",
    action: EXTERNAL_FORM_INTRO,
    expected:
      "Visitors open your HIPAA form instead of sending health details here",
  },
  ...ITEM_BUTTON_STEPS,
]);

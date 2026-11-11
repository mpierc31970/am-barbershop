// The Activate and Use steps of docs/how-to/connect-stripe.md, baked for the hub (10-25; D110,
// D296, PAY-10). "Help me set up Stripe" on Settings › Payments opens them in the P5
// TrainingDrawer, the way the Inbox bakes its how-to (the standalone bundle ships without
// docs/). A drift test (apps/web/test/payments-tab.test.tsx) parses the how-to and fails when
// these differ. Pure.
import type { HowToStepView } from "@cds/ui/hub";

export const CONNECT_HOWTO = "docs/how-to/connect-stripe.md";

export const CONNECT_HELP_TITLE = "Help me set up Stripe";

/** Activate (connect) first, then Use (status, fixes, disconnect, fees). */
export const CONNECT_STEPS: readonly HowToStepView[] = Object.freeze([
  {
    screen: "Hub sidebar",
    action: "Click Settings, then the Payments tab",
    expected:
      'Settings › Payments opens with the heading "Take payments on your site", a Not connected badge, and a grey box: "You own this account, you are the seller, and you pay Stripe\'s fees directly (for example 2.9% + 30¢ online). Support takes no cut."',
  },
  {
    screen: "Settings › Payments",
    action: "Click Connect your Stripe account",
    expected:
      'The button reads "Opening Stripe…" with a spinner, then Stripe\'s own setup page opens (in test mode, the "Connect a test Stripe account" page)',
  },
  {
    screen: "Stripe's setup page",
    action:
      "Sign in to the Stripe account you already have, or create a free one, and answer Stripe's questions about your business and bank account (about 10 minutes)",
    expected:
      "Stripe shows that your details are submitted and sends you back to Support (in test mode, click Connect test account)",
  },
  {
    screen: "Settings › Payments",
    action: "Wait a moment after you come back",
    expected:
      '"Checking your Stripe account…" shows with a spinner, then the badge turns to Connected and a toast reads "Stripe connected. Your site can take payments online."',
  },
  {
    screen: "Settings › Payments",
    action: "Look at the Connected section",
    expected:
      'It lists Account (your business name and "acct ending" with the last 4 characters), Online payments On, and Last checked (for example "2 minutes ago")',
  },
  {
    screen: "Settings › Payments",
    action: "Click Check again next to Last checked",
    expected:
      'Support asks Stripe for the latest status; Last checked changes to "just now"',
  },
  {
    screen: "Settings › Payments",
    action: "Click Open your Stripe dashboard",
    expected:
      "Your Stripe dashboard opens in a new tab, where you see payments, payouts and receipts",
  },
  {
    screen: "Settings › Payments, badge Setup not finished",
    action: "Read the yellow note, then click Finish Stripe setup",
    expected:
      'The note reads "Your Stripe account isn\'t finished yet, so online payments are off. Pick up where you left off; Stripe saves your progress." The button opens Stripe where you left off; finish it to see Connected and the toast',
  },
  {
    screen:
      'Settings › Payments, badge Needs attention (the tab label reads "Payments · 1")',
    action: "Read the yellow note, then click Finish Stripe setup",
    expected:
      "The note explains Stripe paused payments, usually for a missing detail or document, and that customers can still book and pay in person. Finish what Stripe asks for; back on the tab the badge returns to Connected",
  },
  {
    screen: "Settings › Payments, badge Not connected after a disconnect",
    action: "Read the yellow note, then click Connect your Stripe account",
    expected:
      'The note reads "Your Stripe account was disconnected, so online payments are off." Connecting again turns payments back on',
  },
  {
    screen: "Your Stripe dashboard",
    action:
      "To disconnect, remove A&M Barber Studio under Settings › Connected accounts",
    expected:
      "Online payments on your site stop straight away. There is no Disconnect button in the hub; the tab shows the Not connected state",
  },
  {
    screen: "Your site, while payments are paused",
    action: "Open a booking or event page that takes payment",
    expected:
      'Customers see "Online payment is paused; you can still book and pay in person." and can still book',
  },
  {
    screen: "Settings › Payments",
    action: "Read the grey fees box",
    expected:
      'It always reads "You own this account, you are the seller, and you pay Stripe\'s fees directly (for example 2.9% + 30¢ online). Support takes no cut." Stripe charges its fees from your own account; Support never adds a fee',
  },
]);

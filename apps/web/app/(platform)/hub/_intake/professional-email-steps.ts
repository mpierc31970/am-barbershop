// The "Use" steps of docs/how-to/professional-email-address.md, baked for the hub (06-22;
// D110). The free-mail line under the email preview opens them in the P5 TrainingDrawer, the
// same way add-on training shows its baked how-to steps (the standalone bundle ships without
// docs/). A drift test (apps/web/test/email-routing.test.tsx) parses the how-to with the
// add-on generator's parseUseSteps and fails when these differ. Pure.
import type { HowToStepView } from "@cds/ui/hub";

export const PRO_EMAIL_HOWTO = "docs/how-to/professional-email-address.md";

export const PRO_EMAIL_TITLE = "Get an address at your own domain";

export const PRO_EMAIL_STEPS: readonly HowToStepView[] = Object.freeze([
  {
    screen: "Your domain",
    action:
      'Check you own a web address, like riverabakery.com. If you don\'t have one yet, choose "I need a domain" in setup step Domain & the rest',
    expected: "You know the domain your email address will use",
  },
  {
    screen:
      "An email provider of your choice (Google Workspace, Microsoft 365, Zoho Mail, Fastmail or your domain registrar's email)",
    action:
      "Sign up for a mailbox on your domain and follow the provider's steps to connect it to the domain",
    expected:
      "The provider says your domain is verified, and you can send and receive at an address like orders@riverabakery.com",
  },
  {
    screen: "Your new mailbox",
    action: "Send a test email to it from another address",
    expected: "The test arrives in the new mailbox",
  },
  {
    screen: "Settings, Email tab (/hub/settings?tab=email)",
    action:
      "Under Everything goes to, click Change address, type the new address and click Save and send confirmation",
    expected:
      'A toast reads "We sent a confirmation to orders@riverabakery.com." The new address shows Waiting for confirmation, and your old address keeps getting email until you confirm',
  },
  {
    screen: "Your new mailbox",
    action: "Open the email from Support and click Confirm this address",
    expected:
      'The page reads "Address confirmed." Back in Settings, Email, the new address shows Confirmed and the old one is gone',
  },
  {
    screen: "Settings, Email tab, How your emails look to customers",
    action: "Read the preview",
    expected:
      '"Replies go to" shows your new address, and the line about Gmail is gone. The From stays your business name at your site\'s sending address',
  },
  // 14-46 (ONB-10): sending from your own domain once it is connected.
  {
    screen:
      "Settings, Email tab, How your emails look to customers, once your domain is connected (see Connect your domain)",
    action: "Read the sending line under the preview",
    expected:
      'It reads "Setting up sending from riverabakery.com. This usually takes under an hour." Emails keep going out under your business name meanwhile',
  },
  {
    screen: "The same line, usually within an hour",
    action: "Read it again",
    expected:
      'It reads "Emails now send from hello@riverabakery.com." and the From line of the preview shows that address',
  },
  {
    screen: "The same row, field Send from (the part before @riverabakery.com)",
    action: "Type another name, like bookings, and click Save sending address",
    expected:
      'A toast reads "Emails now send from bookings@riverabakery.com." Replies still go to your main address',
  },
  {
    screen: "The same row, if setup couldn't finish",
    action: "Read the warning",
    expected:
      'It reads "We couldn\'t finish setting up sending from riverabakery.com. Support is checking it. Emails still send under your business name." Nothing to do: Support fixes it',
  },
]);

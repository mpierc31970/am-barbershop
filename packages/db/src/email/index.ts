// @cds/db email pipeline (EMAIL-01, ONB-10). Named exports only.
export { sendEmail, emailSendFailures, EmailSendFailed } from "./send";
export type { SendResult, SendDeps } from "./send";
export { canSend, addSuppression, isSuppressed } from "./suppressions";
export type {
  SendAs,
  SuppressionReason,
  SuppressionScope,
} from "./suppressions";
export {
  captureTransport,
  loggingTransport,
  getEmailTransport,
} from "./transport";
export type { EmailTransport, RenderedEmail } from "./transport";
export { signLink, verifyLink } from "./links";
export {
  linkSecret,
  platformUrl,
  mailDomain,
  supportEmail,
  postalAddress,
} from "./env";
export { renderEmail, shortDate } from "./render/templates";
export type { EmailData, RenderedParts } from "./render/templates";

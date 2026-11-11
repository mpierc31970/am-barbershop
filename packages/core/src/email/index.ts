// @cds/core/email: the email class table, add-on composition, address helpers, sender identity,
// escaping and the suppression rule (EMAIL-01, ONB-10, D112, D138, D173, D267). Pure and
// Edge/browser-safe; never re-exported from the @cds/core root. The send API in @cds/db accepts
// only registered types.
export type { EmailClass, EmailPurpose, EmailTypeSpec } from "./types";
export { EMAIL_TYPES, composeEmailTypes, lookupEmailType } from "./registry";
export type { CoreEmailType, EmailTypeRegistry } from "./registry";
export {
  ERR_EMAIL,
  FREE_MAIL_DOMAINS,
  emailDomain,
  isDomainName,
  isEmail,
  isFreeMail,
  normaliseEmail,
} from "./address";
export {
  DEFAULT_SENDING_LOCAL_PART,
  SENDING_LOCAL_PART,
  isSendingLocalPart,
  senderFor,
} from "./sender";
export type { ResolvedSender, SenderIdentity } from "./sender";
export { escapeHtml, formatAddress, headerValue } from "./escape";
export { suppressionBlocks } from "./suppression";

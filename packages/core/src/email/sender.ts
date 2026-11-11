// Sender identity (ONB-10, D112, D173, T-06-11). An org's mail goes out under its business name
// from <slug>@<platform mail domain>, with the routed address as Reply-To. A verified own
// domain sends as <local part>@<own domain> (P14, 14-25: the owner's local part, "hello" when
// unset or invalid). A free-mail domain is never the From, whatever the flags.
// CDS Support mail (P12, D97) is no-reply: "CDS Support" <no-reply@<mail domain>>, no Reply-To,
// so nobody can start a reply-by-email chain.
import { InvalidInput } from "../errors";
import { isDomainName, isEmail, isFreeMail } from "./address";
import { headerValue } from "./escape";

export type SenderIdentity =
  | { kind: "cds"; noReply?: true }
  | {
      kind: "org";
      name: string;
      slug: string;
      replyTo: string;
      ownDomain: string | null;
      sendingDomainVerified: boolean;
      /** P14 (14-25): the owner's chosen local part on the verified own domain. */
      localPart?: string;
    };

export type ResolvedSender = {
  fromName: string;
  fromAddress: string;
  replyTo: string | null;
};

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * The owner-chosen local part of an own-domain From (P14-P20, T-14-25-03): lowercase letters,
 * digits, dots and dashes, starting and ending alphanumeric, at most 64, never "..".
 */
export const SENDING_LOCAL_PART = /^[a-z0-9]([a-z0-9.-]{0,62}[a-z0-9])?$/;
export const DEFAULT_SENDING_LOCAL_PART = "hello";

export function isSendingLocalPart(v: unknown): v is string {
  return (
    typeof v === "string" && SENDING_LOCAL_PART.test(v) && !v.includes("..")
  );
}
const CDS_NAME = "Connections Design Studios";
const CDS_SUPPORT_NAME = "CDS Support";

function mailDomainOf(env: { mailDomain: string }): string {
  const d = env.mailDomain.trim().toLowerCase();
  if (!isDomainName(d)) {
    throw new InvalidInput(
      `Mail domain "${headerValue(d)}" is not a domain name.`,
    );
  }
  return d;
}

function assertNotFreeMail(from: string): string {
  if (isFreeMail(from)) {
    throw new InvalidInput(`Refusing a free-mail From address (${from}).`);
  }
  return from;
}

export function senderFor(
  sender: SenderIdentity,
  env: { mailDomain: string; supportEmail: string | null },
): ResolvedSender {
  const mailDomain = mailDomainOf(env);
  if (sender.kind === "cds" && sender.noReply === true) {
    return {
      fromName: CDS_SUPPORT_NAME,
      fromAddress: assertNotFreeMail(`no-reply@${mailDomain}`),
      replyTo: null,
    };
  }
  if (sender.kind === "cds") {
    const support = env.supportEmail?.trim().toLowerCase() ?? "";
    return {
      fromName: CDS_NAME,
      fromAddress: assertNotFreeMail(`hello@${mailDomain}`),
      replyTo: isEmail(support) ? support : null,
    };
  }
  const slug = SLUG.test(sender.slug) ? sender.slug : "site";
  const own = sender.ownDomain?.trim().toLowerCase() ?? "";
  const useOwn =
    sender.sendingDomainVerified &&
    own !== "" &&
    isDomainName(own) &&
    !isFreeMail(own);
  const local = sender.localPart?.trim().toLowerCase() ?? "";
  const ownLocal = isSendingLocalPart(local)
    ? local
    : DEFAULT_SENDING_LOCAL_PART;
  const fromAddress = useOwn ? `${ownLocal}@${own}` : `${slug}@${mailDomain}`;
  const reply = sender.replyTo.trim().toLowerCase();
  return {
    fromName: headerValue(sender.name) || CDS_NAME,
    fromAddress: assertNotFreeMail(fromAddress),
    replyTo: isEmail(reply) ? reply : null,
  };
}

// Mail stand-in (logged, not sent), mirroring the platform's loggingTransport: one line per
// recipient with a 12-hex recipient hash. Never an address, a name or a body in the log.
import { recipientHash } from "./crypto.ts";

export type FailsafeMail = {
  type: "failsafe.request_owner" | "failsafe.request_staff";
  orgSlug: string;
  addon: string;
  to: string;
  subject: string;
  text: string;
};

export type MailTransport = { send(msg: FailsafeMail): Promise<void> };

function headerValue(v: string): string {
  return v.replace(/[\r\n"]/g, " ").slice(0, 120);
}

export function loggingMail(
  log: (line: string) => void = (l) => console.info(l),
): MailTransport {
  return {
    async send(msg) {
      log(
        `[failsafe-mail] ${headerValue(msg.type)} ${headerValue(msg.orgSlug)}/${headerValue(msg.addon)} to=${recipientHash(msg.to)}`,
      );
    },
  };
}

/** The env-selected transport. Only the logging stand-in exists until the platform's SES account. */
export function mailFromEnv(v: string | undefined): MailTransport {
  if (v === undefined || v === "") return loggingMail();
  throw new Error(
    `FAILSAFE_MAIL_TRANSPORT="${v}" has no implementation yet (unset it to use the logging stand-in)`,
  );
}

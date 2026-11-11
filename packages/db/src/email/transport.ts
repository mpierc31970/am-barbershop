// EmailTransport port (EMAIL-01, ONB-10, CONTEXT A5-Q3; PD-17, T-06-24). Every rendered email
// leaves through here. P6 stand-in: logged-not-sent. It logs one line (type, org id or "cds",
// a 12-char recipient hash, subject) and never the address or the body. Outside production it
// also writes the full message to the object store under dev/mail/ for HUMAN-CHECKS.
// GO-LIVE: P12 "AWS SES" row: the SES transport swaps in behind this port (CDS_EMAIL_TRANSPORT).
import { createHash } from "node:crypto";
import { createTransport } from "nodemailer";
import { headerValue } from "@cds/core/email";
import { getObjectStore } from "../storage";
import { devMailKey, envPrefix } from "../storage/keys";
import type { ObjectStore } from "../storage/object-store";

export type RenderedEmail = {
  type: string;
  orgId: string | null;
  to: string;
  fromName: string;
  fromAddress: string;
  replyTo: string | null;
  subject: string;
  preheader: string;
  html: string;
  text: string;
  headers: Record<string, string>;
};

export interface EmailTransport {
  send(msg: RenderedEmail): Promise<void>;
}

function recipientHash(to: string): string {
  return createHash("sha256")
    .update(to.trim().toLowerCase())
    .digest("hex")
    .slice(0, 12);
}

export function loggingTransport(
  opts: { store?: ObjectStore; now?: () => Date } = {},
): EmailTransport {
  const now = opts.now ?? (() => new Date());
  return {
    async send(msg) {
      const org = msg.orgId ? headerValue(msg.orgId) : "cds";
      console.info(
        `[email-standin] ${headerValue(msg.type)} ${org} to=${recipientHash(msg.to)} subject="${headerValue(msg.subject).replace(/"/g, "'")}"`,
      );
      // envPrefix() throws on an unknown CDS_ENV; production ("") writes nothing (PD-17).
      if (!opts.store || envPrefix() === "") return;
      const at = now();
      const headers = {
        From: `${msg.fromName} <${msg.fromAddress}>`,
        To: msg.to,
        ...(msg.replyTo ? { "Reply-To": msg.replyTo } : {}),
        Subject: msg.subject,
        ...msg.headers,
      };
      await opts.store.put(
        devMailKey(at, msg.type, "headers.json"),
        JSON.stringify(
          {
            type: msg.type,
            orgId: msg.orgId,
            preheader: msg.preheader,
            headers,
          },
          null,
          2,
        ),
        "application/json",
      );
      await opts.store.put(
        devMailKey(at, msg.type, "message.html"),
        msg.html,
        "text/html; charset=utf-8",
      );
      await opts.store.put(
        devMailKey(at, msg.type, "message.txt"),
        msg.text,
        "text/plain; charset=utf-8",
      );
    },
  };
}

/** In-memory transport for tests. */
export function captureTransport(): EmailTransport & { sent: RenderedEmail[] } {
  const sent: RenderedEmail[] = [];
  return {
    sent,
    send(msg) {
      sent.push(structuredClone(msg));
      return Promise.resolve();
    },
  };
}

/**
 * Temporary SMTP transport (Titan mailbox) until SES (P12). The mailbox only lets its own address
 * send, so From is always SMTP_FROM; the original sender becomes Reply-To.
 */
export function smtpTransport(
  env: NodeJS.ProcessEnv = process.env,
): EmailTransport {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD } = env;
  const from = env.SMTP_FROM || SMTP_USER;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD || !from) {
    throw new Error(
      "CDS_EMAIL_TRANSPORT=smtp needs SMTP_HOST, SMTP_USER, SMTP_PASSWORD",
    );
  }
  const port = Number(SMTP_PORT || 465);
  const mailer = createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
  });
  return {
    async send(msg) {
      await mailer.sendMail({
        from: { name: msg.fromName, address: from },
        to: msg.to,
        replyTo:
          msg.replyTo ??
          (msg.fromAddress !== from ? msg.fromAddress : undefined),
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        headers: msg.headers,
      });
      console.info(
        `[email-smtp] ${headerValue(msg.type)} to=${recipientHash(msg.to)} sent`,
      );
    },
  };
}

/** The configured transport: logging stand-in by default, SMTP when CDS_EMAIL_TRANSPORT=smtp. */
export function getEmailTransport(): EmailTransport {
  const v = process.env.CDS_EMAIL_TRANSPORT;
  if (v === undefined || v === "" || v === "log") {
    return loggingTransport({ store: getObjectStore() });
  }
  if (v === "smtp") return smtpTransport();
  throw new Error(
    `CDS_EMAIL_TRANSPORT="${v}" has no implementation yet (unset it to use the logging stand-in)`,
  );
}

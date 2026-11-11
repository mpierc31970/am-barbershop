// P12 support emails (12-05; UI-SPEC Emails lines 665-681; COMM-10, D97; T-12-05-01/03).
import { EMAIL_TYPES } from "@cds/core/email";
import { SUPPORT_COPY } from "@cds/core/support";
import { describe, expect, it } from "vitest";
import { renderEmail, type EmailData } from "./render/templates";

const HUB = "https://cds.needtobeedgy.com/hub";
const FOOTER = SUPPORT_COPY.NO_REPLY_FOOTER;

const base = (
  over: Partial<EmailData["support.notify"]> = {},
): EmailData["support.notify"] => ({
  kind: "support.reply",
  business: "Rivera Bakery",
  ticket: { number: 1042, subject: "Menu page photo is blurry" },
  authorFirstName: "Mara",
  excerpt: "I swapped the photo for the full-size one.",
  href: `${HUB}/support/tickets/1042`,
  ...over,
});

describe("support email types (registry)", () => {
  it("support.notify and support.sla_risk are transactional core types", () => {
    for (const t of ["support.notify", "support.sla_risk"] as const) {
      const spec: { class: string; owner: string; sentBy?: string } =
        EMAIL_TYPES[t];
      expect(spec.class, t).toBe("transactional");
      expect(spec.owner, t).toBe("core");
      expect(spec.sentBy, t).toBeUndefined();
    }
  });
});

describe("support.notify", () => {
  it("support.reply: subject, preheader, body, excerpt, button, footer", () => {
    const m = renderEmail("support.notify", base());
    expect(m.subject).toBe("Support replied to ticket #1042");
    expect(m.preheader).toBe("Menu page photo is blurry");
    expect(m.text).toContain(
      'Mara from Support replied to your ticket "Menu page photo is blurry".',
    );
    expect(m.text).toContain("I swapped the photo for the full-size one.");
    expect(m.text).toContain("Read the reply");
    expect(m.text).toContain(
      "Replies to this email aren't read. Reply in your hub.",
    );
    expect(m.html).toContain("Replies to this email aren&#39;t read.");
  });

  it("clips the excerpt to 300 characters (full text only in the hub)", () => {
    const long = "x".repeat(299) + "YZ" + "tail-never-sent";
    const m = renderEmail("support.notify", base({ excerpt: long }));
    expect(m.text).not.toContain("tail-never-sent");
    expect(m.text).not.toContain("YZ");
    expect(m.text).toContain("x".repeat(299) + "Y");
  });

  it("support.status per status", () => {
    const w = renderEmail(
      "support.notify",
      base({
        kind: "support.status",
        ticket: { number: 1042, subject: "Menu", status: "waiting_on_you" },
      }),
    );
    expect(w.subject).toBe("Ticket #1042 is now Waiting on you");
    expect(w.text).toContain("Support needs something from you to continue.");
    expect(w.text).toContain("Open the ticket");
    const r = renderEmail(
      "support.notify",
      base({
        kind: "support.status",
        ticket: { number: 7, subject: "Menu", status: "resolved" },
      }),
    );
    expect(r.text).toContain(
      "Support marked this resolved. If it isn't, reply in your hub within 7 days to reopen it.",
    );
    const c = renderEmail(
      "support.notify",
      base({
        kind: "support.status",
        ticket: { number: 7, subject: "Menu", status: "closed" },
      }),
    );
    expect(c.text).toContain("This ticket is closed. Open a new one any time.");
    for (const m of [w, r, c]) expect(m.text).toContain(FOOTER);
  });

  it("cds.message, cds.note, cds.document, cds.notice", () => {
    const msg = renderEmail(
      "support.notify",
      base({ kind: "cds.message", ticket: undefined, excerpt: "Hello!" }),
    );
    expect(msg.subject).toBe("New message from Support");
    expect(msg.preheader).toBe("Rivera Bakery");
    expect(msg.text).toContain("Mara from Support wrote:");
    expect(msg.text).toContain("Read the message");

    const note = renderEmail(
      "support.notify",
      base({ kind: "cds.note", ticket: undefined, title: "Launch plan" }),
    );
    expect(note.subject).toBe("A note from Support: Launch plan");
    expect(note.text).toContain("Read the note");

    const doc = renderEmail(
      "support.notify",
      base({
        kind: "cds.document",
        ticket: undefined,
        title: "Brand guide",
        excerpt: "secret body",
      }),
    );
    expect(doc.subject).toBe("Support shared a document: Brand guide");
    expect(doc.text).toContain("Brand guide is in Documents in your hub.");
    expect(doc.text).not.toContain("secret body");
    expect(doc.text).toContain("Open Documents");

    const notice = renderEmail(
      "support.notify",
      base({
        kind: "cds.notice",
        ticket: undefined,
        title: "Support is working on your site until 4:00 pm",
        excerpt: "Support is working on your site until 4:00 pm. Changes wait.",
      }),
    );
    expect(notice.subject).toBe(
      "Support is working on your site until 4:00 pm",
    );
    expect(notice.text).toContain("Open your hub");
    for (const m of [msg, note, doc, notice]) {
      expect(m.text).toContain(FOOTER);
    }
  });

  it("refuses a ticket kind without a ticket", () => {
    expect(() =>
      renderEmail("support.notify", base({ ticket: undefined })),
    ).toThrow();
  });
});

describe("support.sla_risk (staff)", () => {
  it("subject, preheader, facts and the CLI line; no button", () => {
    const m = renderEmail("support.sla_risk", {
      ticketNumber: 1042,
      business: "Rivera Bakery",
      typeLabel: "Something isn't working",
      age: "1 day 20 hours",
      due: "3:00 pm today",
    });
    expect(m.subject).toBe("SLA at risk: #1042 · Rivera Bakery");
    expect(m.preheader).toBe("Due 3:00 pm today");
    expect(m.text).toContain("npm run support:show -- --ticket 1042");
    expect(m.text).toContain("Something isn't working");
    expect(m.text).toContain(FOOTER);
    expect(m.html.match(/<a /g)).toHaveLength(1); // the logo link only
  });
});

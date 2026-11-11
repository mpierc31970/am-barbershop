// P14_COPY (14-03 choice 4): UI-SPEC copy verbatim, example data as typed slots.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GATE_RULE_NAMES,
  JARGON,
  NEEDS_YOU,
  OWNER_STEP_FOR,
  OWNER_STEP_WORDS,
  P14_COPY,
  STAFF_ALERT_KIND_WORDS,
  STAFF_STEP_WORDS,
} from "./index";

const at = { domain: "riverabakery.com", registrar: "GoDaddy" };

describe("P14_COPY (UI-SPEC Copywriting Contract)", () => {
  it("holds the CONTEXT anchors verbatim", () => {
    expect(P14_COPY.STRIP).toBe(
      "Preview: this site is in development and not live yet.",
    );
    expect(P14_COPY.STRIP_DRAFT).toBe("Preview: showing unpublished changes.");
    expect(P14_COPY.WAITING_BODY).toBe(
      "Usually under an hour, sometimes up to 48. We'll email you when it's done.",
    );
    expect(
      P14_COPY.EMAIL_FOUND({ provider: "Google Workspace", count: 7 }),
    ).toBe(
      "We found your email at Google Workspace. We'll copy these 7 records exactly before anything changes.",
    );
    expect(P14_COPY.DOM_OWN).toBe(
      "Your domain stays registered in your name. Support never buys or transfers domains.",
    );
    expect(P14_COPY.CONNECTED_READY(at)).toBe(
      "Ready. Goes live at riverabakery.com when Support approves your launch.",
    );
    expect(P14_COPY.EXPIRY_7({ ...at, date: "3 Mar" })).toBe(
      "Renew riverabakery.com at GoDaddy, or your site and email stop on 3 Mar.",
    );
    expect(P14_COPY.SEND_ON({ address: "hello@riverabakery.com" })).toBe(
      "Emails now send from hello@riverabakery.com.",
    );
    expect(P14_COPY.BANNER({ days: 23, next: "move your DNS" })).toBe(
      "Moving away · 23 days left · Next: move your DNS",
    );
    expect(P14_COPY.CANCEL_DELEGATED).toBe(
      "Their DNS now lives with us. Hand it back first. The zone is kept; cancelling only stops the site steps.",
    );
  });

  it("fills the UI-SPEC examples to the exact sentences", () => {
    expect(P14_COPY.MISMATCH_B({ count: 1, registrar: "GoDaddy" })).toBe(
      "After the switch, 1 email record didn't match the copy. Your email keeps working at GoDaddy, because Support never changed anything there. Change your nameservers back now. Support has been alerted and will contact you today.",
    );
    expect(P14_COPY.HANDBACK_MISMATCH({ count: 1 })).toBe(
      "1 email record is missing at your new DNS. Switch your nameservers back to ours until it's added: your email keeps working there.",
    );
    expect(P14_COPY.FIND_CDS_T({ count: 1 })).toBe(
      "Support is reviewing 1 record with you.",
    );
    expect(P14_COPY.ZONE_ADDED({ count: 3 })).toBe(
      "Zone file added. We found 3 more records and added them to the copy.",
    );
    expect(
      P14_COPY.REVIEW_STRIP({ page: 3, total: 7, title: "About us" }),
    ).toBe("Review mode · Page 3 of 7 · About us");
    expect(
      P14_COPY.APPROVE_BLOCKED({ waitingOn: "waiting on nameservers" }),
    ).toBe("Domain not prepared: waiting on nameservers.");
    expect(
      P14_COPY.APPROVE_B({ business: "Rivera Bakery", domain: at.domain }),
    ).toBe(
      "Make Rivera Bakery live at riverabakery.com? Support runs the last five domain steps (records, edge, HTTPS, switch, search). It takes a few minutes. Live is final once the switch finishes.",
    );
    expect(P14_COPY.CHECK_FAILED(at)).toBe(
      "We couldn't read riverabakery.com's records just now. We'll try again in a few minutes; nothing has changed.",
    );
    expect(P14_COPY.TEST_DNS_STRIP).toBe("Test DNS page. No real DNS changes.");
    expect(P14_COPY.DOM_CLOSED).toBe(
      "Domain connection opens soon. Support will email you when you can connect yours.",
    );
  });

  it("is frozen", () => {
    expect(Object.isFrozen(P14_COPY)).toBe(true);
    expect(Object.isFrozen(JARGON)).toBe(true);
    expect(Object.isFrozen(NEEDS_YOU)).toBe(true);
  });

  it("never uses an owner-forbidden word in owner copy (UI-SPEC Voice)", () => {
    const staffOnly = new Set([
      "CANCEL_DELEGATED",
      "APPROVE_BLOCKED",
      "APPROVE_B",
      "STAFF_NO_DOMAIN",
      "STAFF_NOT_LEAVING",
      "TEST_DNS_STRIP",
      "TEST_DNS_EMPTY",
      "TEST_DNS_RUN_HINT",
      "BTN_RETAKE_SNAPSHOT",
      "BTN_RERUN_POST_SWITCH",
      "BTN_RERUN_HANDBACK",
      "BTN_TEST_DNS_CHANGE_NS",
      "DOM_CF_REGISTRAR",
    ]);
    const sample = {
      ...at,
      provider: "Google Workspace",
      count: 2,
      date: "3 Mar",
      type: "TXT",
      fileDomain: "other.com",
      current: "Zoho Mail",
      next: "Google Workspace",
      service: "Google",
      prefix: "google-site-verification=",
      console: "Google Admin",
      address: "hello@riverabakery.com",
      page: 1,
      total: 2,
      title: "About us",
      email: "maria@gmail.com",
      days: 2,
      sender: "Maria",
      business: "Rivera Bakery",
      endsOn: "14 Nov 2026",
      waitingOn: "x",
    };
    const banned =
      /\b(delegation|propagation|cutover|apex|gate|snapshot|sweep|cloudflare|edge|prober|rdap|ttl|tenant|301)\b/i;
    for (const [key, v] of Object.entries(P14_COPY)) {
      if (staffOnly.has(key)) continue;
      const text =
        typeof v === "function" ? (v as (s: object) => string)(sample) : v;
      expect(text, key).not.toMatch(banned);
    }
  });

  it("has no imports beyond types (Edge boundary)", () => {
    const src = readFileSync(join(import.meta.dirname, "copy.ts"), "utf8");
    expect(src).not.toMatch(/^import (?!type)/m);
  });
});

describe("P14 word lists", () => {
  it("JARGON has the eleven explainers", () => {
    expect(Object.keys(JARGON)).toHaveLength(11);
    expect(JARGON.dnssec).toBe(
      "DNSSEC is an extra lock on your DNS. It has to be off while your records move.",
    );
  });

  it("owner step words: six, in order, the switch names the domain", () => {
    const words = OWNER_STEP_WORDS(at);
    expect(words).toEqual([
      "Records copied",
      "Nameservers changed",
      "Pointing your domain to your new site",
      "Setting up the secure connection",
      "Switching to riverabakery.com",
      "Telling search engines",
    ]);
    for (const i of Object.values(OWNER_STEP_FOR)) {
      expect(words[i]).toBeDefined();
    }
  });

  it("staff step words cover the ten step keys in order", () => {
    expect(Object.values(STAFF_STEP_WORDS)).toEqual([
      "1 Snapshot",
      "2 Zone",
      "3 Gate",
      "4 Nameservers",
      "5 Delegation verified",
      "6 Site records",
      "7 Edge",
      "8 HTTPS",
      "9 Cutover",
      "10 Search",
    ]);
  });

  it("gate rules G1-G7 and ten staff alert kinds", () => {
    expect(Object.keys(GATE_RULE_NAMES)).toEqual([
      "G1",
      "G2",
      "G3",
      "G4",
      "G5",
      "G6",
      "G7",
    ]);
    expect(Object.keys(STAFF_ALERT_KIND_WORDS)).toHaveLength(10);
    expect(STAFF_ALERT_KIND_WORDS.post_switch_mismatch).toBe(
      "post-switch mismatch",
    );
  });

  it("Needs you copy fills from data", () => {
    expect(NEEDS_YOU.nameservers({ registrar: "GoDaddy" })).toEqual({
      title: "Change your nameservers at GoDaddy",
      sub: "Two values to paste. About 5 minutes.",
      action: "See the steps",
    });
    expect(NEEDS_YOU.renew({ ...at, date: "3 Mar" }).sub).toBe(
      "Expires 3 Mar.",
    );
  });
});

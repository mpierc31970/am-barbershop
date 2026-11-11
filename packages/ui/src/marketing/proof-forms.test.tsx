// Proof, report aside and form primitive contract (15-11; 15-UI-SPEC Home §5, Work, Contact, Report,
// Accessibility contract). Rendered with react-dom/server in the node unit project.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MK_COPY, type Testimonial, type WorkSite } from "@cds/core/marketing";
import { DemoPanel } from "./DemoPanel";
import {
  MkCheckbox,
  MkErrorSummary,
  MkFormStatus,
  MkRadioGroup,
  MkTextArea,
  MkTextField,
} from "./MkForm";
import { ProofList } from "./ProofList";
import { ReportAside } from "./ReportAside";
import { TestimonialList } from "./TestimonialList";

const html = (node: ReactElement) => renderToStaticMarkup(node);
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"');

const SITES: readonly WorkSite[] = [
  {
    name: "Alpha Studio",
    url: "https://alpha.example",
    path: "studio",
    outcome: "Booking for a busy team",
    confirmed: true,
  },
  {
    name: "Beta Coaching",
    url: "https://beta.example",
    path: "standard",
    outcome: "A clear site for a coach",
    confirmed: false,
  },
];

const QUOTES: readonly Testimonial[] = [
  {
    quote: "Short and kind.",
    name: "Ana",
    business: "Alpha Studio",
    confirmed: true,
  },
  {
    quote: "x".repeat(141),
    name: "Ben",
    business: "Beta Coaching",
    confirmed: false,
  },
];

describe("DemoPanel", () => {
  it("renders nothing without a URL", () => {
    expect(html(<DemoPanel url={null} />)).toBe("");
  });

  it("renders the heading, body and a new-tab Open the demo link", () => {
    const out = html(<DemoPanel url="https://demo.example/" />);
    expect(out).toContain('data-mk-field="berry"');
    expect(text(out)).toContain(MK_COPY.HOME.DEMO_H2);
    expect(text(out)).toContain(MK_COPY.HOME.DEMO_BODY);
    const link = out.match(/<a\b[^>]*href="https:\/\/demo\.example\/"[^>]*>/);
    expect(link).not.toBeNull();
    expect(link![0]).toContain('target="_blank"');
    expect(link![0]).toContain('rel="noopener"');
    expect(text(out)).toContain(MK_COPY.HOME.OPEN_DEMO);
  });
});

describe("ProofList", () => {
  it("renders nothing for an empty list", () => {
    expect(html(<ProofList sites={[]} showDrafts />)).toBe("");
  });

  it("renders each site as a row with path name and a noopener Visit site link", () => {
    const out = html(<ProofList sites={SITES} showDrafts />);
    expect((out.match(/<li\b/g) ?? []).length).toBe(2);
    expect(text(out)).toContain("Alpha Studio");
    expect(text(out)).toContain("Studio");
    expect(text(out)).toContain("Standard");
    expect(text(out)).toContain("Booking for a busy team");
    const links = out.match(/<a\b[^>]*>/g) ?? [];
    expect(links.length).toBe(2);
    for (const a of links) {
      expect(a).toContain('target="_blank"');
      expect(a).toContain('rel="noopener"');
    }
    expect(text(out)).toContain(MK_COPY.WORK.VISIT);
  });

  it("shows DRAFT on unconfirmed entries only when showDrafts", () => {
    const off = html(<ProofList sites={SITES} showDrafts={false} />);
    expect(text(off)).not.toContain(MK_COPY.COMMON.DRAFT);
    // WR-C05: with drafts hidden, an unconfirmed entry is dropped, not shown unmarked.
    expect((off.match(/<li\b/g) ?? []).length).toBe(1);
    expect(text(off)).not.toContain("Beta Coaching");
    const on = html(<ProofList sites={SITES} showDrafts />);
    expect(text(on).split(MK_COPY.COMMON.DRAFT).length - 1).toBe(1);
  });

  it("renders the optional title and respects limit", () => {
    const out = html(
      <ProofList
        sites={SITES}
        showDrafts={false}
        title={MK_COPY.WORK.SITES_H2}
        limit={1}
      />,
    );
    expect(out).toMatch(/<h2\b/);
    expect((out.match(/<li\b/g) ?? []).length).toBe(1);
  });
});

describe("TestimonialList", () => {
  it("renders nothing for an empty list", () => {
    expect(html(<TestimonialList items={[]} showDrafts />)).toBe("");
  });

  it("renders figure/blockquote/figcaption with Name, Business", () => {
    const out = html(
      <TestimonialList
        items={QUOTES.map((q) => ({ ...q, confirmed: true }))}
        showDrafts={false}
      />,
    );
    expect((out.match(/<figure\b/g) ?? []).length).toBe(2);
    expect((out.match(/<blockquote\b/g) ?? []).length).toBe(2);
    expect(text(out)).toContain("Ana, Alpha Studio");
    expect(text(out)).not.toContain(MK_COPY.COMMON.DRAFT);
  });

  it("uses Heading size up to 140 chars and Body otherwise", () => {
    const out = html(<TestimonialList items={QUOTES} showDrafts />);
    const quotes = out.match(/<blockquote\b[^>]*>/g) ?? [];
    expect(quotes[0]).toContain("clamp(28px");
    expect(quotes[1]).not.toContain("clamp(28px");
  });

  it("shows DRAFT on unconfirmed entries when showDrafts", () => {
    const out = html(<TestimonialList items={QUOTES} showDrafts />);
    expect(text(out).split(MK_COPY.COMMON.DRAFT).length - 1).toBe(1);
  });

  it("drops unconfirmed quotes when drafts are hidden (WR-C05)", () => {
    const out = html(<TestimonialList items={QUOTES} showDrafts={false} />);
    expect((out.match(/<figure\b/g) ?? []).length).toBe(1);
    expect(text(out)).not.toContain("Ben, Beta Coaching");
  });
});

describe("ReportAside", () => {
  it("lists the six steps verbatim and links What we host", () => {
    const out = html(<ReportAside />);
    expect(text(out)).toContain("What happens next");
    expect((out.match(/<li\b/g) ?? []).length).toBe(6);
    for (const step of MK_COPY.REPORT.NEXT_STEPS) {
      expect(text(out)).toContain(step);
    }
    expect(out).toMatch(/href="\/hosting-rules"/);
    expect(text(out)).toContain(MK_COPY.REPORT.HOSTING_LINK);
  });
});

/** The opening tag of the element with this id. */
const tagById = (markup: string, id: string) =>
  markup.match(new RegExp(`<[a-z]+(?:\\s[^>]*?)?\\sid="${id}"[^>]*>`))?.[0] ??
  "";

describe("MkTextField", () => {
  it("renders a visible label above the input, linked by htmlFor", () => {
    const out = html(
      <MkTextField id="c-name" name="name" label="Name" autoComplete="name" />,
    );
    expect(out).toMatch(/<label\b[^>]*for="c-name"[^>]*>Name<\/label>/);
    expect(out.indexOf("<label")).toBeLessThan(out.indexOf("<input"));
    const input = tagById(out, "c-name");
    expect(input).toContain('name="name"');
    expect(input).toContain('autoComplete="name"');
    expect(input).not.toContain("aria-invalid");
    expect(input).not.toContain("aria-describedby");
  });

  it("links help and error by aria-describedby and sets aria-invalid", () => {
    const out = html(
      <MkTextField
        id="c-email"
        name="email"
        type="email"
        label="Email"
        help="We reply here."
        error={MK_COPY.CONTACT.ERR_EMAIL}
      />,
    );
    const input = tagById(out, "c-email");
    expect(input).toContain('aria-invalid="true"');
    const described = input.match(/aria-describedby="([^"]*)"/)?.[1] ?? "";
    expect(described.split(" ")).toEqual(["c-email-help", "c-email-error"]);
    expect(tagById(out, "c-email-error")).not.toBe("");
    expect(text(out)).toContain(MK_COPY.CONTACT.ERR_EMAIL);
    // CircleAlert icon beside the error text (icon + text, never colour alone)
    expect(out).toMatch(/lucide-circle-alert|lucide-alert-circle/);
  });

  it("renders a prefix outside the input when given", () => {
    const out = html(
      <MkTextField
        id="calc-sales"
        name="sales"
        label="Sales"
        prefix="$"
        inputMode="decimal"
      />,
    );
    expect(text(out)).toContain("$");
    expect(tagById(out, "calc-sales")).toContain('inputMode="decimal"');
  });
});

describe("MkTextArea", () => {
  it("shows the counter and announces it politely only from 90%", () => {
    const low = html(
      <MkTextArea
        id="c-msg"
        name="message"
        label="Message"
        counter={{ value: 1240, max: 2000 }}
      />,
    );
    expect(text(low)).toContain("1,240 of 2,000");
    const liveLow = low.match(/<span\b[^>]*aria-live="polite"[^>]*>([^<]*)</);
    expect(liveLow).not.toBeNull();
    expect(liveLow![1]).toBe("");
    const high = html(
      <MkTextArea
        id="c-msg"
        name="message"
        label="Message"
        counter={{ value: 1800, max: 2000 }}
      />,
    );
    const liveHigh = high.match(/<span\b[^>]*aria-live="polite"[^>]*>([^<]*)</);
    expect(liveHigh![1]).toBe("1,800 of 2,000");
  });
});

describe("MkRadioGroup", () => {
  it("is a fieldset with a legend and one native radio per option", () => {
    const out = html(
      <MkRadioGroup
        id="c-topic"
        name="topic"
        legend={MK_COPY.CONTACT.TOPIC}
        options={MK_COPY.CONTACT.TOPICS}
        defaultValue="call"
        error={MK_COPY.CONTACT.ERR_TOPIC}
      />,
    );
    expect(out).toMatch(/<fieldset\b[^>]*id="c-topic"/);
    expect(text(out)).toContain(MK_COPY.CONTACT.TOPIC);
    expect((out.match(/type="radio"/g) ?? []).length).toBe(3);
    expect(tagById(out, "c-topic-call")).toContain("checked");
    expect(tagById(out, "c-topic")).toContain("c-topic-error");
    expect(text(out)).toContain(MK_COPY.CONTACT.ERR_TOPIC);
  });
});

describe("MkCheckbox", () => {
  it("renders a native checkbox with its label", () => {
    const out = html(<MkCheckbox id="r-ok" name="ok" label="I agree" />);
    expect(tagById(out, "r-ok")).toContain('type="checkbox"');
    expect(out).toMatch(/<label\b[^>]*for="r-ok"/);
  });
});

describe("MkErrorSummary", () => {
  it("renders nothing with no errors", () => {
    expect(html(<MkErrorSummary title="x" errors={[]} />)).toBe("");
  });

  it("is a focusable alert linking each field by #id", () => {
    const out = html(
      <MkErrorSummary
        title={MK_COPY.CONTACT.ERROR_SUMMARY}
        errors={[
          { id: "c-name", message: MK_COPY.CONTACT.ERR_NAME },
          { id: "c-email", message: MK_COPY.CONTACT.ERR_EMAIL },
        ]}
      />,
    );
    expect(out).toContain('role="alert"');
    expect(out).toContain('tabindex="-1"');
    expect(out).toContain('href="#c-name"');
    expect(out).toContain('href="#c-email"');
    expect(text(out)).toContain(MK_COPY.CONTACT.ERROR_SUMMARY);
    expect(text(out)).toContain(MK_COPY.CONTACT.ERR_NAME);
  });
});

describe("MkFormStatus", () => {
  it("renders a success status and an error alert", () => {
    const ok = html(
      <MkFormStatus tone="success" title={MK_COPY.CONTACT.SENT_H2}>
        Done
      </MkFormStatus>,
    );
    expect(ok).toContain('role="status"');
    expect(text(ok)).toContain(MK_COPY.CONTACT.SENT_H2);
    const bad = html(
      <MkFormStatus tone="error">{MK_COPY.CONTACT.ERR_SERVER}</MkFormStatus>,
    );
    expect(bad).toContain('role="alert"');
  });
});

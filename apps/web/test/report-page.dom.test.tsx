// @vitest-environment jsdom
// 13-30 Task 2: /report page and form (STAFF-24, D249; 13-UI-SPEC "Report page" lines
// 959-979, a11y line 1108). The action module and the Turnstile widget are mocked.
import { P13_COPY } from "@cds/core/staff";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  click,
  flush,
  mount,
  submit,
  typeInto,
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";

const action = vi.hoisted(() => ({ submitReportAction: vi.fn() }));
vi.mock("../app/actions/report", () => action);
vi.mock("../app/(platform)/start/_components/Turnstile", async () => {
  const { useEffect } = await import("react");
  return {
    Turnstile: ({ onToken }: { onToken: (t: string) => void }) => {
      useEffect(() => onToken("test-token"), [onToken]);
      return null;
    },
  };
});

const { default: ReportPage, metadata } =
  await import("../app/(platform)/(marketing)/report/page");
const { REPORT_COPY, REPORT_FIELD_IDS } = await import("../lib/report-form");
const { ABUSE_EMAIL, MK_ABUSE_LINE, MK_COPY } =
  await import("@cds/core/marketing");

let mounted: Mounted | null = null;
beforeEach(() => action.submitReportAction.mockReset());
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

async function mountPage(site?: string | string[]) {
  const ui = await ReportPage({
    searchParams: Promise.resolve(site === undefined ? {} : { site }),
  });
  mounted = mount(ui);
  return mounted.container;
}

function input(root: ParentNode, id: string): HTMLInputElement {
  const el = root.querySelector<HTMLInputElement>(`#${id}`);
  if (!el) throw new Error(`no #${id}`);
  return el;
}

function radio(root: ParentNode, value: string): HTMLInputElement {
  const el = root.querySelector<HTMLInputElement>(
    `input[type="radio"][name="category"][value="${value}"]`,
  );
  if (!el) throw new Error(`no radio ${value}`);
  return el;
}

describe("/report", () => {
  it("the server-rendered form has an action, so a pre-hydration submit is never a GET with the fields in the URL (WR-D01)", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const ui = await ReportPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(ui);
    const form = /<form\s[^>]*>/.exec(html)?.[0] ?? "";
    expect(form).not.toBe("");
    expect(form).toMatch(/\saction="/);
    expect(form).not.toMatch(/method="get"/i);
  });

  it("is noindex and titled Report a problem", () => {
    expect(metadata.title).toBe("Report a problem");
    expect(metadata.robots).toEqual({ index: false, follow: false });
    // 13-51: Lighthouse meta-description gate.
    expect(metadata.description).toBe(REPORT_COPY.INTRO);
  });

  it("?site=bella.example.com pre-fills https://bella.example.com/", async () => {
    const root = await mountPage("bella.example.com");
    expect(root.querySelector("h1")?.textContent).toBe("Report a problem");
    expect(input(root, REPORT_FIELD_IDS.url).value).toBe(
      "https://bella.example.com/",
    );
    expect(input(root, REPORT_FIELD_IDS.site).value).toBe("bella.example.com");
  });

  it("keeps a dev port from the footer link", async () => {
    const root = await mountPage("blocks.localhost:3100");
    expect(input(root, REPORT_FIELD_IDS.url).value).toBe(
      "https://blocks.localhost:3100/",
    );
  });

  it("ignores a ?site= that is not a host", async () => {
    const root = await mountPage("javascript:alert(1)//");
    expect(input(root, REPORT_FIELD_IDS.url).value).toBe("");
    expect(input(root, REPORT_FIELD_IDS.site).value).toBe("");
  });

  it("uses native radios in a fieldset with a legend", async () => {
    const root = await mountPage();
    const legend = Array.from(root.querySelectorAll("fieldset > legend")).map(
      (l) => l.textContent,
    );
    expect(legend).toContain("What are you reporting?");
    expect(
      root.querySelectorAll('input[type="radio"][name="category"]'),
    ).toHaveLength(4);
  });

  it("choosing Copyright reveals the DMCA statement block; choosing Other hides it", async () => {
    const root = await mountPage();
    expect(root.querySelector('[data-testid="report-dmca"]')).toBeNull();
    click(radio(root, "copyright"));
    const block = root.querySelector('[data-testid="report-dmca"]');
    expect(block).not.toBeNull();
    expect(block?.textContent).toContain(REPORT_COPY.DMCA_GOODFAITH);
    expect(block?.textContent).toContain(REPORT_COPY.DMCA_ACCURATE);
    expect(block?.textContent).toContain("DRAFT");
    expect(root.querySelector(`#${REPORT_FIELD_IDS.signature}`)).not.toBeNull();
    click(radio(root, "other"));
    expect(root.querySelector('[data-testid="report-dmca"]')).toBeNull();
  });

  it("a failed submit shows an error summary linking to each invalid field, and keeps the text", async () => {
    action.submitReportAction.mockResolvedValue({
      status: "idle",
      error: null,
      fieldErrors: {
        url: REPORT_COPY.ERR_URL,
        signature: REPORT_COPY.ERR_SIGNATURE,
      },
    });
    const root = await mountPage();
    click(radio(root, "copyright"));
    typeInto(input(root, REPORT_FIELD_IDS.description), "Typed words stay.");
    submit(root.querySelector("form"));
    await flush();
    const summary = root.querySelector("#report-error-summary");
    expect(summary).not.toBeNull();
    expect(document.activeElement).toBe(summary);
    const links = Array.from(summary!.querySelectorAll("a")).map((a) => [
      a.getAttribute("href"),
      a.textContent,
    ]);
    expect(links).toEqual([
      [`#${REPORT_FIELD_IDS.url}`, REPORT_COPY.ERR_URL],
      [`#${REPORT_FIELD_IDS.signature}`, REPORT_COPY.ERR_SIGNATURE],
    ]);
    click(summary!.querySelector("a"));
    expect(document.activeElement?.id).toBe(REPORT_FIELD_IDS.url);
    expect(input(root, REPORT_FIELD_IDS.url).getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(
      root.querySelector<HTMLTextAreaElement>(
        `#${REPORT_FIELD_IDS.description}`,
      )?.value,
    ).toBe("Typed words stay.");
    const fd = action.submitReportAction.mock.calls[0]![1] as FormData;
    expect(fd.get("category")).toBe("copyright");
    expect(fd.get("cf-turnstile-response")).toBe("test-token");
  });

  it("the rate limit shows RATE-REPORT", async () => {
    action.submitReportAction.mockResolvedValue({
      status: "idle",
      error: P13_COPY.RATE_REPORT,
      fieldErrors: {},
    });
    const root = await mountPage();
    submit(root.querySelector("form"));
    await flush();
    expect(root.textContent).toContain(P13_COPY.RATE_REPORT);
  });

  it("success shows Report received with the case ref", async () => {
    action.submitReportAction.mockResolvedValue({
      status: "sent",
      ref: "R-32",
      email: "ana@example.org",
    });
    const root = await mountPage("bella.example.com");
    submit(root.querySelector("form"));
    await flush();
    expect(root.querySelector("form")).toBeNull();
    const h1 = root.querySelector("h1");
    expect(h1?.textContent).toBe("Report received");
    expect(document.activeElement).toBe(h1);
    expect(root.querySelector("strong")?.textContent).toBe("R-32");
    expect(root.textContent).toContain(
      "Your report number is R-32. We sent a copy to ana@example.org. Support reviews reports within 2 business days.",
    );
    const again = root.querySelector('a[href="/report"]');
    expect(again?.textContent).toBe("Report something else");
  });
  // 15-20 (HUB-07, D-UI-P15-23): restyled inside the marketing layout.
  it("shows the abuse@ line under the intro as a mailto link", async () => {
    const root = await mountPage();
    const line = root.querySelector('[data-testid="report-abuse-line"]');
    expect(line?.textContent).toBe(MK_ABUSE_LINE);
    const a = line?.querySelector("a");
    expect(a?.getAttribute("href")).toBe(`mailto:${ABUSE_EMAIL}`);
    expect(a?.textContent).toBe(ABUSE_EMAIL);
  });

  it("has the What happens next aside with the six D249 steps and What we host", async () => {
    const root = await mountPage();
    const aside = root.querySelector("aside");
    expect(aside?.querySelector("h2")?.textContent).toBe(
      MK_COPY.REPORT.NEXT_H2,
    );
    const steps = Array.from(aside!.querySelectorAll("ol > li")).map(
      (li) => li.textContent,
    );
    expect(steps).toEqual([...MK_COPY.REPORT.NEXT_STEPS]);
    expect(aside?.querySelector('a[href="/hosting-rules"]')?.textContent).toBe(
      MK_COPY.REPORT.HOSTING_LINK,
    );
  });

  it("renders no hub-, site- or cds- utility class (marketing surface)", async () => {
    const root = await mountPage("bella.example.com");
    click(radio(root, "copyright"));
    const classes = Array.from(root.querySelectorAll("[class]")).flatMap((el) =>
      (el.getAttribute("class") ?? "").split(/\s+/),
    );
    expect(classes.length).toBeGreaterThan(0);
    expect(classes.filter((c) => /(^|[:-])(hub|site|cds)-/.test(c))).toEqual(
      [],
    );
  });

  it("keeps the aside after a successful send", async () => {
    action.submitReportAction.mockResolvedValue({
      status: "sent",
      ref: "R-33",
      email: "",
    });
    const root = await mountPage();
    submit(root.querySelector("form"));
    await flush();
    expect(root.querySelector("aside ol")?.children).toHaveLength(6);
    expect(root.textContent).not.toContain(MK_ABUSE_LINE);
  });
});

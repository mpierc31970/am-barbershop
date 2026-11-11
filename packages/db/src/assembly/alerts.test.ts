// P8 (08-10): the staff hand-off emails' data and send helpers (TMPL-04, CONTEXT A4-Q1, A2-Q4).
import type { AssemblyReport } from "@cds/core/templates";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailData } from "../email/render/templates";
import {
  assembledEmailData,
  sendSiteAssembled,
  sendSiteAssemblyFailed,
} from "./alerts";

const ORG = "abcdefghijklmno";
const AT = new Date("2026-10-07T19:14:00.000Z");
const HOME = "https://rivera-bakery.sites.connectionsdesignstudios.com/";

const report: AssemblyReport = {
  templateId: "standard-v1",
  templateVersion: 1,
  slots: [
    {
      page: "home",
      slot: "hero",
      source: "fallback",
      note: "No main photo: text-only hero",
    },
    { page: "home", slot: "intro", source: "provided" },
    { page: "home", slot: "services", source: "provided", note: "6 of 12" },
    {
      page: "home",
      slot: "proof",
      source: "omitted",
      note: "No add-on installed",
    },
  ],
  polish: [
    "Questions and answers · 2 of 3 need answers; they stay hidden until answered",
    "Theme: import the impeccable theme (D45)",
  ],
  pages: [{ key: "home", label: "Home", outcome: "created", path: "/" }],
};

const meta = {
  businessName: "Rivera Bakery",
  pathLabel: "Standard",
  businessTypeLabel: "Bakery",
  orgId: ORG,
  assembledAt: AT,
  pages: [{ label: "Home", url: HOME }],
};

describe("assembledEmailData (choice 2)", () => {
  it("builds To polish, Filled and Left out lines in staff words", () => {
    const d = assembledEmailData(report, meta);
    expect(d.polish).toEqual([
      "Hero · Default used · No main photo: text-only hero",
      "Questions and answers · 2 of 3 need answers; they stay hidden until answered",
      "Theme: import the impeccable theme (D45)",
    ]);
    expect(d.filled).toEqual(["Intro", "Services (6 of 12)"]);
    expect(d.leftOut).toEqual(["Proof (No add-on installed)"]);
  });

  it("carries the template, meta and pages; nothing else", () => {
    const d = assembledEmailData(report, meta);
    expect(d).toEqual({
      ...meta,
      templateId: "standard-v1",
      templateVersion: 1,
      polish: expect.any(Array),
      filled: expect.any(Array),
      leftOut: expect.any(Array),
    });
  });

  it("a fallback without a note and an omitted slot without a note", () => {
    const d = assembledEmailData(
      {
        ...report,
        polish: [],
        slots: [
          { page: "about", slot: "team", source: "fallback" },
          { page: "about", slot: "gallery", source: "omitted" },
        ],
      },
      meta,
    );
    expect(d.polish).toEqual(["Team · Default used"]);
    expect(d.leftOut).toEqual(["Gallery"]);
  });
});

const assembled = (): EmailData["site.assembled"] =>
  assembledEmailData(report, meta);
const failed: EmailData["site.assembly_failed"] = {
  businessName: "Rivera Bakery",
  errorCode: "PUBLISH_FAILED",
  page: "About",
  finishedPages: ["Home"],
  lastTry: AT,
  orgId: ORG,
  attempts: 3,
};

const cases = [
  {
    type: "site.assembled" as const,
    run: (deps: Parameters<typeof sendSiteAssembled>[1]) =>
      sendSiteAssembled(assembled(), deps),
    data: assembled,
  },
  {
    type: "site.assembly_failed" as const,
    run: (deps: Parameters<typeof sendSiteAssemblyFailed>[1]) =>
      sendSiteAssemblyFailed(failed, deps),
    data: () => failed,
  },
];

describe.each(cases)("$type send helper (choice 4)", ({ type, run, data }) => {
  beforeEach(() => {
    vi.stubEnv("CDS_STAFF_ALERT_EMAIL", "staff@example.com");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("skips with a warning when no staff recipient is configured", async () => {
    vi.stubEnv("CDS_STAFF_ALERT_EMAIL", "");
    vi.stubEnv("CDS_SUPPORT_EMAIL", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const send = vi.fn();
    expect(await run({ send })).toEqual({ status: "skipped" });
    expect(send).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("sends as CDS to the staff recipient with the data", async () => {
    const send = vi.fn().mockResolvedValue({ status: "sent" });
    expect(await run({ send })).toEqual({ status: "sent" });
    expect(send).toHaveBeenCalledTimes(1);
    const [as, t, to, d] = send.mock.calls[0]!;
    expect(as.kind).toBe("cds");
    expect(as.ctx.job).toBe("assembly");
    expect(t).toBe(type);
    expect(to).toBe("staff@example.com");
    expect(d).toEqual(data());
  });

  it("a suppressed recipient is skipped", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const send = vi.fn().mockResolvedValue({ status: "suppressed" });
    expect(await run({ send })).toEqual({ status: "skipped" });
  });

  it("a send error is failed and logs only the error name", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    class SesDown extends Error {
      override name = "SesDown";
    }
    const send = vi
      .fn()
      .mockRejectedValue(new SesDown("secret staff@example.com detail"));
    expect(await run({ send })).toEqual({ status: "failed" });
    const logged = err.mock.calls.flat().join(" ");
    expect(logged).toContain("SesDown");
    expect(logged).not.toContain("secret");
    expect(logged).not.toContain("staff@example.com");
  });
});

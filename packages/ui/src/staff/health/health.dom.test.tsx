// @vitest-environment jsdom
// Health building blocks (13-45; STAFF-13, STAFF-14, CONT-19, D-UI-P13-22; T-13-45-02).
import { act, type ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ToastRegion } from "../../hub/Toast";
import { flush, mount, typeInto, type Mounted } from "../../test-support/dom";
import { StaffActionProvider } from "../dialogs";
import {
  FailsafeInbox,
  HEALTH_COPY,
  HealthTable,
  JobTable,
  MediaUsageTable,
  failsafeSummary,
  formatHealthBytes,
  sortHealthRows,
  thresholdText,
  type FailsafeRowView,
  type HealthRowView,
  type JobRowView,
} from "./index";

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal: () => void;
    close: () => void;
  };
  if (typeof proto.showModal !== "function") {
    proto.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (typeof proto.close !== "function") {
    proto.close = function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
});

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function withProviders(ui: ReactNode) {
  return (
    <ToastRegion>
      <StaffActionProvider
        requestStepUpCode={vi.fn()}
        confirmStepUp={vi.fn()}
        navigate={vi.fn()}
      >
        {ui}
      </StaffActionProvider>
    </ToastRegion>
  );
}

const COMPONENTS: HealthRowView[] = [
  {
    id: "email",
    label: "Email",
    reading: "Email: logged (stand-in)",
    level: "none",
    threshold: "warn any failure in 24 h · critical sending disabled",
    since: null,
  },
  {
    id: "database",
    label: "PocketBase",
    reading: "PocketBase 2400 ms",
    level: "critical",
    threshold: "warn > 500 ms · critical > 2 s",
    since: "2026-10-16T19:10:00.000Z",
  },
  {
    id: "payments",
    label: "Payments",
    reading: "Payments: live",
    level: "ok",
    threshold: "critical when payments are not configured",
    since: null,
  },
];

function job(over: Partial<JobRowView> = {}): JobRowView {
  return {
    id: "job-support",
    job: "support:run",
    label: "Support job",
    schedule: "hourly",
    lastSuccess: "2026-10-16T10:00:00.000Z",
    lastSuccessAgo: "5 h ago",
    level: "critical",
    reading: "Last success 5 h ago · 1 failed step",
    warningText: "> 2 h, SLA missed or failed steps",
    criticalText: "> 4 h, or a service window open > 24 h",
    since: "2026-10-16T14:00:00.000Z",
    ...over,
  };
}

function req(over: Partial<FailsafeRowView> = {}): FailsafeRowView {
  return {
    id: "fffffffffffffff",
    orgId: "aaaaaaaaaaaaaaa",
    business: "Rivera Bakery",
    addon: "Studio Booking",
    name: "Ana Rivera",
    email: "ana@example.com",
    phone: "",
    preferred: "Sat morning",
    message: "Haircut please",
    capturedAt: "2026-10-15T15:00:00.000Z",
    status: "pending",
    convertedRef: "",
    ...over,
  };
}

const FILTER_HREF = (f: string) => `/staff/health?tab=failsafe&status=${f}`;

describe("HealthTable", () => {
  it("a stand-in shows '(stand-in)' with h-none ('Stand-in'), never h-critical", () => {
    mounted = mount(<HealthTable caption="Platform" rows={COMPONENTS} />);
    const row = mounted.container.querySelector('tr[data-level="none"]')!;
    expect(row.textContent).toContain("Email: logged (stand-in)");
    expect(row.textContent).toContain(HEALTH_COPY.standIn);
    expect(row.textContent).not.toContain("Critical");
    // Sorted: critical first.
    const levels = [
      ...mounted.container.querySelectorAll("tbody tr[data-level]"),
    ].map((r) => r.getAttribute("data-level"));
    expect(levels).toEqual(["critical", "ok", "none"]);
    const crit = mounted.container.querySelector('tr[data-level="critical"]')!;
    expect(crit.textContent).toContain("Critical");
    expect(crit.textContent).toMatch(/Critical since \d{1,2}:\d{2}/);
    expect(crit.textContent).toContain("warn > 500 ms · critical > 2 s");
  });

  it("sortHealthRows orders critical, warning, OK, no data", () => {
    const rows = sortHealthRows([
      { level: "none" as const, label: "a" },
      { level: "ok" as const, label: "b" },
      { level: "warn" as const, label: "c" },
      { level: "critical" as const, label: "d" },
    ]);
    expect(rows.map((r) => r.level)).toEqual([
      "critical",
      "warn",
      "ok",
      "none",
    ]);
  });
});

describe("JobTable", () => {
  it("a critical job renders TriangleAlert + 'Critical' and the threshold words", () => {
    mounted = mount(
      <JobTable
        rows={[
          job(),
          job({
            id: "job-health",
            job: "health:run",
            level: "ok",
            criticalText: "> 30 min",
            warningText: "> 15 min, or failed steps",
            since: null,
            lastSuccessAgo: "4 min ago",
          }),
        ]}
      />,
    );
    const crit = mounted.container.querySelector('tr[data-level="critical"]')!;
    expect(crit.textContent).toContain("support:run");
    expect(crit.textContent).toContain("Critical");
    expect(crit.querySelector("svg")).not.toBeNull();
    expect(crit.textContent).toContain(
      "Warning after 2 h, SLA missed or failed steps · Critical after 4 h, or a service window open > 24 h",
    );
    expect(crit.textContent).toContain("5 h ago");
    const td = [...crit.querySelectorAll("td")].find(
      (c) => c.textContent === "5 h ago",
    )!;
    expect(td.getAttribute("title")).toMatch(/2026/);
    expect(mounted.container.textContent).toContain(HEALTH_COPY.jobsNote);
    // Read-only: no buttons.
    expect(mounted.container.querySelector("button")).toBeNull();
  });

  it("thresholdText without a critical part", () => {
    expect(thresholdText({ warning: "> 30 h", critical: null })).toBe(
      "Warning after 30 h",
    );
    expect(thresholdText({ text: "warn > 26 h" })).toBe("warn > 26 h");
  });
});

describe("FailsafeInbox", () => {
  it("Convert with a conflict shows the conflict text and keeps the row Pending", async () => {
    const convert = vi.fn(async () => ({
      ok: true as const,
      data: {
        converted: false as const,
        conflict: "That slot is already taken.",
        message: "That slot is already taken.",
      },
    }));
    mounted = mount(
      withProviders(
        <FailsafeInbox
          rows={[req()]}
          filter="pending"
          filterHref={FILTER_HREF}
          deployment={{ deployed: false, pending: 0, lastPull: null }}
          convert={convert}
          dismiss={vi.fn()}
        />,
      ),
    );
    expect(mounted.container.textContent).toContain(
      HEALTH_COPY.failsafe.notDeployed,
    );
    const btn = mounted.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Convert request from Ana R."]',
    )!;
    act(() => btn.click());
    await flush();
    expect(convert).toHaveBeenCalledWith("fffffffffffffff");
    const alert = mounted.container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("That slot is already taken.");
    const body = mounted.container.querySelector("tbody")!.textContent;
    expect(body).toContain("Pending");
    expect(body).not.toContain("Converted");
  });

  it("Convert success marks the row Converted and toasts", async () => {
    const convert = vi.fn(async () => ({
      ok: true as const,
      data: {
        converted: true as const,
        ref: "bk_123",
        message: "Converted. Created bk_123.",
      },
    }));
    mounted = mount(
      withProviders(
        <FailsafeInbox
          rows={[req()]}
          filter="pending"
          filterHref={FILTER_HREF}
          deployment={{ deployed: true, pending: 1, lastPull: "2:10 PM" }}
          convert={convert}
          dismiss={vi.fn()}
        />,
      ),
    );
    expect(mounted.container.textContent).toContain(
      "Capture service: deployed · 1 waiting · last pull 2:10 PM",
    );
    act(() =>
      mounted!.container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Convert request from Ana R."]',
        )!
        .click(),
    );
    await flush();
    expect(mounted.container.querySelector("tbody")!.textContent).toContain(
      "Converted",
    );
    expect(document.body.textContent).toContain("Converted. Created bk_123.");
  });

  it("Dismiss needs a reason and calls the action with it", async () => {
    const dismiss = vi.fn(async () => ({
      ok: true as const,
      data: { message: "Dismissed." },
    }));
    mounted = mount(
      withProviders(
        <FailsafeInbox
          rows={[req()]}
          filter="pending"
          filterHref={FILTER_HREF}
          deployment={{ deployed: false, pending: 0, lastPull: null }}
          convert={vi.fn()}
          dismiss={dismiss}
        />,
      ),
    );
    act(() =>
      mounted!.container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Dismiss request from Ana R."]',
        )!
        .click(),
    );
    const dialog = document.querySelector("dialog[open]")!;
    expect(dialog.textContent).toContain(HEALTH_COPY.failsafe.dismissTitle);
    const confirm = [...dialog.querySelectorAll("button")].find(
      (b) => b.textContent === HEALTH_COPY.failsafe.dismissConfirm,
    )!;
    expect(confirm.disabled).toBe(true);
    typeInto(dialog.querySelector("textarea"), "Spam request");
    expect(confirm.disabled).toBe(false);
    act(() => confirm.click());
    await flush();
    expect(dismiss).toHaveBeenCalledWith("fffffffffffffff", "Spam request");
    expect(mounted.container.querySelector("tbody")!.textContent).toContain(
      "Dismissed",
    );
  });

  it("empty list and filter chips", () => {
    mounted = mount(
      withProviders(
        <FailsafeInbox
          rows={[]}
          filter="all"
          filterHref={FILTER_HREF}
          deployment={{ deployed: false, pending: 0, lastPull: null }}
          convert={vi.fn()}
          dismiss={vi.fn()}
        />,
      ),
    );
    expect(mounted.container.textContent).toContain(HEALTH_COPY.failsafe.empty);
    const all = mounted.container.querySelector(
      'a[href="/staff/health?tab=failsafe&status=all"]',
    );
    expect(all?.getAttribute("aria-pressed")).toBe("true");
  });

  it("summary helper", () => {
    expect(failsafeSummary(req())).toBe("Sat morning · Ana R.");
  });
});

describe("MediaUsageTable", () => {
  it("shows sizes, '—' delivery with the Bunny title and the over-allowance badge", () => {
    mounted = mount(
      <MediaUsageTable
        rows={[
          {
            orgId: "aaaaaaaaaaaaaaa",
            business: "Small Site",
            imageBytes: 300 * 1024 ** 2,
            videoBytes: 0,
            audioBytes: 0,
            usedBytes: 300 * 1024 ** 2,
            allowanceBytes: 2 * 1024 ** 3,
            deliveryBytes: null,
            level: "ok",
          },
          {
            orgId: "bbbbbbbbbbbbbbb",
            business: "Big Site",
            imageBytes: 1024 ** 3,
            videoBytes: 1.5 * 1024 ** 3,
            audioBytes: 0,
            usedBytes: 2.5 * 1024 ** 3,
            allowanceBytes: 2 * 1024 ** 3,
            deliveryBytes: null,
            level: "full",
          },
        ]}
      />,
    );
    const rows = mounted.container.querySelectorAll("tbody tr");
    expect(rows[0]!.textContent).toContain("Big Site");
    expect(rows[0]!.textContent).toContain("2.5 GB of 2 GB");
    expect(rows[0]!.textContent).toContain(HEALTH_COPY.media.over);
    expect(rows[1]!.textContent).not.toContain(HEALTH_COPY.media.over);
    expect(rows[1]!.textContent).toContain("300 MB");
    const dash = mounted.container.querySelector(
      `span[title="${HEALTH_COPY.media.deliveryTitle}"]`,
    );
    expect(dash?.textContent).toBe("—");
    expect(
      mounted.container.querySelector(
        'a[href="/staff/sites/bbbbbbbbbbbbbbb?tab=media"]',
      ),
    ).not.toBeNull();
  });

  it("formatHealthBytes", () => {
    expect(formatHealthBytes(0)).toBe("0 B");
    expect(formatHealthBytes(1.25 * 1024 ** 3)).toBe("1.3 GB");
    expect(formatHealthBytes(2 * 1024 ** 3)).toBe("2 GB");
  });
});

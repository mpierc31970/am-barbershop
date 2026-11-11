// @vitest-environment jsdom
// Credentials tab (05-UI-SPEC "Credentials tab", "Delete a record", R2; D-UI-P5-16,
// D-UI-P5-17; CONTEXT A5-Q2).
import {
  ToastRegion,
  type AddonPanelActions,
  type AddonPanelData,
  type AddonRecordView,
} from "@cds/ui/hub";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  button,
  click,
  flush,
  mount,
  type Mounted,
} from "../../../ui/src/test-support/dom";
import { DELETE, EMPTY } from "./copy";
import { CredentialsPanel, metaLine } from "./CredentialsPanel";

const nav = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
  search: "",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: nav.replace,
    refresh: nav.refresh,
    push: nav.push,
  }),
  usePathname: () => "/hub/website",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

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
  document.body.innerHTML = "";
  nav.search = "";
  vi.clearAllMocks();
});

const NOW = new Date("2026-09-28T12:00:00Z");
const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });

function actions(over: Partial<AddonPanelActions> = {}): AddonPanelActions {
  return {
    save: vi.fn(() => ok({ id: "c1", held: false })),
    setPublished: vi.fn(() => ok({ held: false })),
    reorder: vi.fn(() => ok(null)),
    remove: vi.fn(() => ok(null)),
    importPreview: vi.fn(() =>
      Promise.resolve({ ok: false as const, code: "x", message: "x" }),
    ),
    importCommit: vi.fn(() =>
      Promise.resolve({ ok: false as const, code: "x", message: "x" }),
    ),
    exportCsv: vi.fn(() => ok({ filename: "c.csv", csv: "" })),
    templateCsv: vi.fn(() => ok({ filename: "c.csv", csv: "" })),
    listBackups: vi.fn(() => ok([])),
    saveBackup: vi.fn(() =>
      ok({
        id: "b1",
        reason: "manual" as const,
        createdAt: new Date().toISOString(),
        count: 0,
      }),
    ),
    restoreBackup: vi.fn(() => ok(null)),
    addToNav: vi.fn(() => ok({ added: true })),
    ...over,
  };
}

function record(
  id: string,
  values: Record<string, unknown> = {},
  held = false,
): AddonRecordView {
  return {
    id,
    held,
    values: {
      title: "RN License",
      issuer: "Texas Board of Nursing",
      category: "Licenses",
      credential_number: "RN123456",
      show_number: false,
      issued_on: "",
      expires_on: "",
      verify_url: "",
      is_published: true,
      sort_order: 1,
      ...values,
    },
  };
}

function data(records: AddonRecordView[], groups?: string[]): AddonPanelData {
  return {
    slug: "credentials",
    name: "Credentials",
    singular: "credential",
    plural: "credentials",
    collection: "credentials",
    records,
    page: {
      id: "p1",
      slug: "credentials",
      url: "https://a.test/credentials",
    },
    trainingTitle: "How Credentials works",
    trainingSteps: [{ screen: "Tab", action: "Add one", expected: "It shows" }],
    csvEnabled: true,
    ...(groups ? { groups } : {}),
  };
}

function render(
  records: AddonRecordView[],
  acts = actions(),
  groups?: string[],
) {
  mounted = mount(
    <ToastRegion>
      <CredentialsPanel data={data(records, groups)} actions={acts} now={NOW} />
    </ToastRegion>,
  );
  return { acts, root: mounted.container };
}

describe("CredentialsPanel", () => {
  it("shows the three-starts empty state and no header primary (R2)", () => {
    const { root } = render([]);
    expect(root.textContent).toContain(EMPTY.heading);
    expect(root.textContent).toContain(EMPTY.body);
    expect(root.textContent).toContain(EMPTY.helper);
    expect(button(root, EMPTY.add)).not.toBeNull();
    expect(button(root, EMPTY.import)).not.toBeNull();
    expect(button(root, EMPTY.how)).not.toBeNull();
    expect(button(root, "Add credential")).toBeNull();
  });

  it("groups rows under header rows with counts, Other last", () => {
    const { root } = render([
      record("c1"),
      record("c2", { title: "CPR", category: "" }),
      record("c3", { title: "AANA", category: "Memberships" }),
      record("c4", { title: "LVN", category: "Licenses" }),
    ]);
    const text = root.textContent ?? "";
    expect(text).toContain("Licenses · 2");
    expect(text).toContain("Memberships · 1");
    expect(text).toContain("Other · 1");
    expect(text.indexOf("Licenses · 2")).toBeLessThan(
      text.indexOf("Other · 1"),
    );
    expect(text).toContain("4 credentials · 4 shown on your site");
    expect(button(root, "Add credential")).not.toBeNull();
  });

  it("builds the meta line with number and validity", () => {
    expect(
      metaLine(record("c1", { expires_on: "2027-03-14 00:00:00.000Z" })),
    ).toBe("Texas Board of Nursing · No. RN123456 · Valid through 14 Mar 2027");
    expect(
      metaLine(
        record("c1", { credential_number: "", issued_on: "2019-06-01" }),
      ),
    ).toBe("Texas Board of Nursing · Issued 2019");
  });

  it("shows Expires soon and Expired badges and the expiring notice", () => {
    const { root } = render([
      record("c1", { expires_on: "2026-11-12 00:00:00.000Z" }),
      record("c2", { title: "CPR", expires_on: "2026-09-27 00:00:00.000Z" }),
      record("c3", { title: "BLS", expires_on: "2027-12-01" }),
    ]);
    const text = root.textContent ?? "";
    expect(text).toContain("Expires soon · 12 Nov");
    expect(text).toContain("Expired · hidden on site");
    expect(text).toContain(
      "1 credential expires in the next 60 days: RN License (12 Nov). Update the dates once you renew.",
    );
    expect(text).toContain("3 credentials · 2 shown on your site");
    click(button(root, "Edit RN License"));
    expect(nav.replace).toHaveBeenCalledWith("/hub/website?record=c1", {
      scroll: false,
    });
  });

  it("puts a scan hold notice before the expiring notice", () => {
    const { root } = render([
      record("c1", { expires_on: "2026-11-12" }),
      record("c2", { title: "CPR" }, true),
    ]);
    expect(root.textContent).toContain("1 credential is being reviewed");
    expect(root.textContent).not.toContain("expires in the next 60 days");
  });

  it("refuses a move across groups: Move down stops at the group edge", async () => {
    const { root, acts } = render([
      record("c1", { title: "RN License", sort_order: 1 }),
      record("c2", { title: "LVN", sort_order: 2 }),
      record("c3", { title: "AANA", category: "Memberships", sort_order: 3 }),
    ]);
    click(button(root, "More actions for LVN"));
    const down = button(root, "Move down")!;
    expect(down.disabled).toBe(true);
    click(button(root, "More actions for LVN"));
    click(button(root, "More actions for RN License"));
    click(button(root, "Move down"));
    await flush();
    expect(acts.reorder).toHaveBeenCalledWith(["c2", "c1", "c3"]);
  });

  it("delete asks with the spec copy and deletes on confirm", async () => {
    const { root, acts } = render([record("c1")]);
    click(button(root, "More actions for RN License"));
    click(button(root, "Delete credential"));
    expect(document.body.textContent).toContain("Delete RN License?");
    const confirm = Array.from(
      document.querySelectorAll<HTMLButtonElement>("dialog button"),
    ).find((b) => b.textContent?.trim() === DELETE.confirm);
    click(confirm);
    await flush();
    expect(acts.remove).toHaveBeenCalledWith("c1");
    expect(document.body.textContent).toContain(DELETE.done);
  });

  it("the drawer opens from ?record=<id> with day values and group suggestions", () => {
    nav.search = "tab=credentials&record=c1";
    render(
      [record("c1", { expires_on: "2027-03-14 00:00:00.000Z" })],
      actions(),
      ["Licenses", "Memberships"],
    );
    expect(document.body.textContent).toContain("Edit credential");
    const expires = document.querySelector<HTMLInputElement>(
      'input[type="date"][value="2027-03-14"]',
    );
    expect(expires).not.toBeNull();
    const options = Array.from(
      document.querySelectorAll("datalist option"),
    ).map((o) => o.getAttribute("value"));
    expect(options).toEqual(["Licenses", "Memberships"]);
    const label = Array.from(document.querySelectorAll("label")).find(
      (l) => l.textContent === "Show number on site",
    )!;
    const show = document.getElementById(label.htmlFor) as HTMLInputElement;
    expect(show.getAttribute("role")).toBe("switch");
    expect(show.checked).toBe(false);
  });

  it("Show on site saves through setPublished", async () => {
    const { root, acts } = render([record("c1")]);
    const sw = root.querySelector<HTMLInputElement>(
      'input[role="switch"][aria-label="Show RN License on site"]',
    )!;
    click(sw);
    await flush();
    expect(acts.setPublished).toHaveBeenCalledWith("c1", false);
  });
});

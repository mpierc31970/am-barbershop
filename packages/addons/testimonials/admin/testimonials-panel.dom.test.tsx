// @vitest-environment jsdom
// Testimonials tab (05-UI-SPEC "Testimonials tab", "Delete a record", R2; D-UI-P5-9).
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
import { DELETE, EMPTY, TOAST } from "./copy";
import { TestimonialsPanel, excerpt, metaLine } from "./TestimonialsPanel";

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

const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });

function actions(over: Partial<AddonPanelActions> = {}): AddonPanelActions {
  return {
    save: vi.fn(() => ok({ id: "t1", held: false })),
    setPublished: vi.fn(() => ok({ held: false })),
    reorder: vi.fn(() => ok(null)),
    remove: vi.fn(() => ok(null)),
    importPreview: vi.fn(() =>
      Promise.resolve({ ok: false as const, code: "x", message: "x" }),
    ),
    importCommit: vi.fn(() =>
      Promise.resolve({ ok: false as const, code: "x", message: "x" }),
    ),
    exportCsv: vi.fn(() => ok({ filename: "t.csv", csv: "" })),
    templateCsv: vi.fn(() => ok({ filename: "t.csv", csv: "" })),
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
      quote:
        "The best bread in town, and the kindest people behind the counter.",
      author_name: "Maria Lopez",
      author_detail: "Owner, Rivera Bakery",
      rating: 5,
      photo_url: "",
      photo_alt: "",
      source: "manual",
      featured: false,
      is_published: true,
      sort_order: 1,
      ...values,
    },
  };
}

function data(
  records: AddonRecordView[],
  pageOver: { inNav?: boolean; navFull?: boolean } = {},
): AddonPanelData {
  return {
    slug: "testimonials",
    name: "Testimonials",
    singular: "testimonial",
    plural: "testimonials",
    collection: "testimonials",
    records,
    page: {
      id: "p1",
      slug: "testimonials",
      url: "https://a.test/testimonials",
      ...pageOver,
    },
    trainingTitle: "How Testimonials works",
    trainingSteps: [{ screen: "Tab", action: "Add one", expected: "It shows" }],
    csvEnabled: true,
  };
}

function render(
  records: AddonRecordView[],
  acts = actions(),
  pageOver: { inNav?: boolean; navFull?: boolean } = {},
) {
  mounted = mount(
    <ToastRegion>
      <TestimonialsPanel data={data(records, pageOver)} actions={acts} />
    </ToastRegion>,
  );
  return { acts, root: mounted.container };
}

describe("TestimonialsPanel", () => {
  it("shows the three-starts empty state and no header primary (R2)", () => {
    const { root } = render([]);
    expect(root.textContent).toContain(EMPTY.heading);
    expect(root.textContent).toContain(EMPTY.body);
    expect(root.textContent).toContain(EMPTY.helper);
    expect(button(root, EMPTY.add)).not.toBeNull();
    expect(button(root, EMPTY.import)).not.toBeNull();
    expect(button(root, EMPTY.how)).not.toBeNull();
    expect(button(root, "Add testimonial")).toBeNull();
    expect(root.textContent).toContain("0 testimonials · 0 shown on your site");
  });

  it("opens the new-testimonial drawer through the URL", () => {
    const { root } = render([]);
    click(button(root, EMPTY.add));
    expect(nav.replace).toHaveBeenCalledWith("/hub/website?record=new", {
      scroll: false,
    });
  });

  it("lists rows with excerpt, meta line, count and the header primary", () => {
    const { root } = render([
      record("t1"),
      record("t2", { is_published: false, author_name: "Bo" }),
    ]);
    expect(button(root, "Add testimonial")).not.toBeNull();
    expect(root.textContent).toContain("2 testimonials · 1 shown on your site");
    expect(root.textContent).toContain(
      "Maria Lopez · Owner, Rivera Bakery · 5 of 5",
    );
    expect(root.textContent).toContain("Hidden");
    expect(root.textContent).toContain("Your Testimonials page: /testimonials");
    expect(root.textContent).not.toContain("coming soon");
    expect(button(root, "Add to navigation")).not.toBeNull();
  });

  it("Add to navigation adds the seeded page and shows In your menu (07-25)", async () => {
    const { root, acts } = render([record("t1")]);
    click(button(root, "Add to navigation"));
    await flush();
    expect(acts.addToNav).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain(
      "Testimonials page added to your menu.",
    );
    expect(root.textContent).toContain("In your menu");
    const arrange = Array.from(root.querySelectorAll("a")).find(
      (a) => a.textContent === "Arrange",
    );
    expect(arrange?.getAttribute("href")).toBe("/hub/website?tab=navigation");
    expect(button(root, "Add to navigation")).toBeNull();
  });

  it("a full menu shows NAV-LIMIT with the Arrange link", async () => {
    const acts = actions({
      addToNav: vi.fn(() => ok({ added: false, reason: "full" as const })),
    });
    const { root } = render([record("t1")], acts);
    click(button(root, "Add to navigation"));
    await flush();
    expect(root.textContent).toContain(
      "Menus hold up to 8 links. Put some under another link, or remove one.",
    );
  });

  it("a page already in the menu reads In your menu from the start", () => {
    const { root } = render([record("t1")], actions(), { inNav: true });
    expect(root.textContent).toContain("In your menu");
    expect(button(root, "Add to navigation")).toBeNull();
  });

  it("featured toggle saves the full record with featured flipped", async () => {
    const { root, acts } = render([record("t1")]);
    const star = button(root, "Feature testimonial from Maria Lopez")!;
    expect(star.getAttribute("aria-pressed")).toBe("false");
    click(star);
    await flush();
    expect(acts.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "t1",
        featured: true,
        quote: expect.stringContaining("The best bread"),
        author_name: "Maria Lopez",
        rating: 5,
      }),
    );
    expect(star.getAttribute("aria-pressed")).toBe("true");
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("hide then star before the refresh: the star save keeps it hidden (B-WR-02)", async () => {
    let release: () => void = () => undefined;
    const acts = actions({
      setPublished: vi.fn(
        () =>
          new Promise<{ ok: true; data: { held: boolean } }>((resolve) => {
            release = () => resolve({ ok: true, data: { held: false } });
          }),
      ),
    });
    const { root } = render([record("t1")], acts);
    const sw = root.querySelector<HTMLInputElement>('input[role="switch"]')!;
    click(sw);
    click(button(root, "Feature testimonial from Maria Lopez"));
    await flush();
    // The star waits for the pending Show on site change on the same record.
    expect(acts.save).not.toHaveBeenCalled();
    release();
    await flush();
    await flush();
    expect(acts.setPublished).toHaveBeenCalledWith("t1", false);
    expect(acts.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "t1",
        featured: true,
        is_published: false,
      }),
    );
  });

  it("star then hide: the hide runs after the star save, never before it", async () => {
    const order: string[] = [];
    let release: () => void = () => undefined;
    const acts = actions({
      save: vi.fn(
        () =>
          new Promise<{ ok: true; data: { id: string; held: boolean } }>(
            (resolve) => {
              release = () => {
                order.push("save");
                resolve({ ok: true, data: { id: "t1", held: false } });
              };
            },
          ),
      ),
      setPublished: vi.fn(() => {
        order.push("publish");
        return ok({ held: false });
      }),
    });
    const { root } = render([record("t1")], acts);
    click(button(root, "Feature testimonial from Maria Lopez"));
    click(root.querySelector<HTMLInputElement>('input[role="switch"]')!);
    await flush();
    expect(acts.setPublished).not.toHaveBeenCalled();
    release();
    await flush();
    await flush();
    expect(order).toEqual(["save", "publish"]);
  });

  it("Show on site failure snaps back and toasts", async () => {
    const acts = actions({
      setPublished: vi.fn(() =>
        Promise.resolve({
          ok: false as const,
          code: "server",
          message: "nope",
        }),
      ),
    });
    const { root } = render([record("t1")], acts);
    const sw = root.querySelector<HTMLInputElement>(
      'input[role="switch"][aria-label="Show testimonial from Maria Lopez on site"]',
    )!;
    expect(sw.checked).toBe(true);
    click(sw);
    await flush();
    expect(acts.setPublished).toHaveBeenCalledWith("t1", false);
    expect(sw.checked).toBe(true);
    expect(document.body.textContent).toContain(TOAST.toggleFailed);
  });

  it("a held save on Show on site stays off with the review toast", async () => {
    const acts = actions({ setPublished: vi.fn(() => ok({ held: true })) });
    const { root } = render([record("t1", { is_published: false })], acts);
    const sw = root.querySelector<HTMLInputElement>('input[role="switch"]')!;
    click(sw);
    await flush();
    expect(sw.checked).toBe(false);
    expect(document.body.textContent).toContain(TOAST.held);
  });

  it("delete asks with the spec copy and deletes on confirm", async () => {
    const { root, acts } = render([record("t1")]);
    click(button(root, "More actions for testimonial from Maria Lopez"));
    click(button(root, "Delete testimonial"));
    const body = document.body.textContent ?? "";
    expect(body).toContain("Delete the testimonial from Maria Lopez?");
    expect(body).toContain(DELETE.body);
    expect(button(document.body, DELETE.keep)).not.toBeNull();
    const confirm = Array.from(
      document.querySelectorAll<HTMLButtonElement>("dialog button"),
    ).find((b) => b.textContent?.trim() === DELETE.confirm);
    click(confirm);
    await flush();
    expect(acts.remove).toHaveBeenCalledWith("t1");
    expect(document.body.textContent).toContain(DELETE.done);
  });

  it("shows one notice: scan hold before nothing shown", () => {
    const { root } = render([record("t1", { is_published: false }, true)]);
    expect(root.textContent).toContain("1 testimonial is being reviewed");
    expect(root.textContent).not.toContain("None of your testimonials");
    mounted?.unmount();
    mounted = null;
    const again = render([record("t2", { is_published: false })]);
    expect(again.root.textContent).toContain("None of your testimonials");
  });

  it("row helpers trim the excerpt to 90 characters and skip a zero rating", () => {
    expect(excerpt("x".repeat(120))).toBe(`${"x".repeat(90)}…`);
    expect(metaLine(record("t1", { rating: 0, author_detail: "" }))).toBe(
      "Maria Lopez",
    );
  });

  it("the drawer opens from ?record=<id> with the record's values", () => {
    nav.search = "tab=testimonials&record=t1";
    render([record("t1")]);
    expect(document.body.textContent).toContain("Edit testimonial");
    const quote = document.querySelector("textarea")!;
    expect(quote.value).toContain("The best bread");
    expect(document.body.textContent).toMatch(/66 \/ 1,?000/);
  });
});

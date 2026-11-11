// @vitest-environment jsdom
// 07-25 Task 3: the Add page row's "Show this page in the site menu" checkbox (choice 13;
// UI-SPEC line 335). On by default below 6 top-level links, off at 6-7, disabled with the
// NAV-LIMIT helper at 8; its value reaches createPageAction as addToNav.
import { ToastRegion } from "@cds/ui/hub";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  button,
  click,
  flush,
  mount,
  typeInto,
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));
const createPageAction = vi.hoisted(() => vi.fn());
vi.mock("../app/actions/pages", () => ({ createPageAction }));

const { AddPageRow, ADD_TO_NAV_LABEL, ADD_TO_NAV_HELP } =
  await import("../app/(platform)/hub/website/AddPageRow");

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

function open(navTopCount: number) {
  m = mount(
    <ToastRegion>
      <AddPageRow
        count={1}
        limit={10}
        taken={["home"]}
        reserved={[]}
        navTopCount={navTopCount}
      >
        <p>list</p>
      </AddPageRow>
    </ToastRegion>,
  );
  click(button(m.container, "Add page"));
  return m.container.querySelector("#new-page-nav") as HTMLInputElement;
}

describe("Add page menu checkbox", () => {
  it("is on below 6 links and sends addToNav", async () => {
    const box = open(5);
    expect(m!.container.textContent).toContain(ADD_TO_NAV_LABEL);
    expect(m!.container.textContent).toContain(ADD_TO_NAV_HELP);
    expect(box.checked).toBe(true);
    createPageAction.mockResolvedValue({
      ok: true,
      data: { id: "p9", navAdded: true },
    });
    typeInto(m!.container.querySelector("#new-page-title"), "About");
    click(button(m!.container, "Create page"));
    await flush();
    expect(createPageAction).toHaveBeenCalledWith({
      title: "About",
      slug: "about",
      addToNav: true,
    });
  });

  it("is off at 6 links and can be ticked", () => {
    const box = open(6);
    expect(box.checked).toBe(false);
    expect(box.disabled).toBe(false);
  });

  it("is disabled with NAV-LIMIT at 8 links", () => {
    const box = open(8);
    expect(box.checked).toBe(false);
    expect(box.disabled).toBe(true);
    expect(m!.container.textContent).toContain(
      "Menus hold up to 8 links. Put some under another link, or remove one.",
    );
  });
});

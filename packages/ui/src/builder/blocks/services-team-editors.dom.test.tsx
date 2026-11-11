// @vitest-environment jsdom
// Services and Our team builder forms (08-05; TMPL-01, TMPL-02, D119; 08-UI-SPEC "Services
// block" / "Our team block" builder forms; choices 2 and 4).
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, mount, type Mounted } from "../../test-support/dom";
import {
  BuilderBusinessProvider,
  SERVICES_HREF,
  TEAM_HOURS_HREF,
  type BuilderBusiness,
} from "./business-context";
import { ServicesEditor, servicesCountLine } from "./ServicesEditor";
import { TeamEditor } from "./TeamEditor";
import type { CoreBlockEditorProps } from "./types";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const BUSINESS: BuilderBusiness = {
  name: "Rivera Bakery",
  phone: "512-555-0100",
  addressText: "",
  hasHours: true,
  socials: [],
  businessType: "bakery",
};

const SERVICES = {
  heading: "Services",
  display: "cards",
  limit: 0,
  show_descriptions: true,
  show_durations: true,
};

function props(content: Record<string, unknown>) {
  const onChange = vi.fn();
  const p: CoreBlockEditorProps = {
    type: "x",
    content,
    onChange,
    errors: {},
    popups: [],
  };
  return { p, onChange };
}

const withBusiness = (ui: ReactNode, value: BuilderBusiness | null) => (
  <BuilderBusinessProvider value={value}>{ui}</BuilderBusinessProvider>
);

function byLabel(root: HTMLElement, label: string): HTMLInputElement {
  const l = [...root.querySelectorAll("label")].find(
    (x) => x.textContent?.trim() === label,
  );
  if (!l) throw new Error(`no label ${label}`);
  const id = l.getAttribute("for");
  return (
    id ? root.querySelector(`[id="${id}"]`) : l.querySelector("input")
  ) as HTMLInputElement;
}

function radio(root: HTMLElement, title: string): HTMLInputElement {
  const l = [...root.querySelectorAll("label")].find((x) =>
    x.textContent?.startsWith(title),
  );
  if (!l) throw new Error(`no radio ${title}`);
  return l.querySelector("input")!;
}

function select(el: HTMLSelectElement, value: string) {
  act(() => {
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("servicesCountLine", () => {
  it("says how many services show", () => {
    expect(servicesCountLine(12, 6)).toBe(
      "Showing 6 of 12 services on your site.",
    );
    expect(servicesCountLine(4, 0)).toBe(
      "Showing all 4 services on your site.",
    );
    expect(servicesCountLine(4, 6)).toBe(
      "Showing all 4 services on your site.",
    );
    expect(servicesCountLine(0, 6)).toBe("No services are showing yet.");
  });
});

describe("ServicesEditor", () => {
  it("renders the fields, the source line and the Edit services link", () => {
    const { p } = props(SERVICES);
    mounted = mount(<ServicesEditor {...p} />);
    const root = mounted.container;
    expect(byLabel(root, "Heading").value).toBe("Services");
    expect(root.textContent).toContain("Display");
    expect(radio(root, "Cards").checked).toBe(true);
    expect(radio(root, "List").checked).toBe(false);
    const how = byLabel(
      root,
      "How many to show",
    ) as unknown as HTMLSelectElement;
    expect([...how.options].map((o) => o.textContent)).toEqual([
      "All",
      "3",
      "6",
      "9",
      "12",
    ]);
    expect(how.value).toBe("0");
    expect(byLabel(root, "Show descriptions")).toBeTruthy();
    expect(byLabel(root, "Show how long each takes")).toBeTruthy();
    expect(root.textContent).toContain(
      "Services come from Website › Services, so changes there show here right away.",
    );
    const link = [...root.querySelectorAll("a")].find(
      (a) => a.textContent === "Edit services",
    )!;
    expect(link.getAttribute("href")).toBe(SERVICES_HREF);
    expect(link.getAttribute("target")).toBeNull();
    // No provider -> no count line.
    expect(root.textContent).not.toContain("on your site.");
  });

  it("calls onChange with each content key", () => {
    const { p, onChange } = props(SERVICES);
    mounted = mount(<ServicesEditor {...p} />);
    const root = mounted.container;
    click(radio(root, "List"));
    expect(onChange).toHaveBeenCalledWith("display", "list");
    select(
      byLabel(root, "How many to show") as unknown as HTMLSelectElement,
      "6",
    );
    expect(onChange).toHaveBeenCalledWith("limit", 6);
    click(byLabel(root, "Show descriptions"));
    expect(onChange).toHaveBeenCalledWith("show_descriptions", false);
    click(byLabel(root, "Show how long each takes"));
    expect(onChange).toHaveBeenCalledWith("show_durations", false);
  });

  it("shows the count line from publishedServices", () => {
    const cases: [number, number, string][] = [
      [12, 6, "Showing 6 of 12 services on your site."],
      [4, 0, "Showing all 4 services on your site."],
      [0, 0, "No services are showing yet."],
    ];
    for (const [n, limit, line] of cases) {
      const { p } = props({ ...SERVICES, limit });
      mounted = mount(
        withBusiness(<ServicesEditor {...p} />, {
          ...BUSINESS,
          publishedServices: n,
        }),
      );
      expect(mounted.container.textContent).toContain(line);
      mounted.unmount();
      mounted = null;
    }
    const { p } = props(SERVICES);
    mounted = mount(withBusiness(<ServicesEditor {...p} />, BUSINESS));
    expect(mounted.container.textContent).not.toContain("on your site.");
  });
});

describe("TeamEditor", () => {
  it("renders Heading, the switches and the source line", () => {
    const { p, onChange } = props({
      heading: "Our team",
      show_roles: true,
      show_bios: true,
    });
    mounted = mount(<TeamEditor {...p} />);
    const root = mounted.container;
    expect(byLabel(root, "Heading").value).toBe("Our team");
    expect(root.textContent).toContain(
      "Team members come from Settings › Team & hours. Members you hide there don't show.",
    );
    const link = [...root.querySelectorAll("a")].find(
      (a) => a.textContent === "Edit your team",
    )!;
    expect(link.getAttribute("href")).toBe(TEAM_HOURS_HREF);
    click(byLabel(root, "Show roles"));
    expect(onChange).toHaveBeenCalledWith("show_roles", false);
    click(byLabel(root, "Show bios"));
    expect(onChange).toHaveBeenCalledWith("show_bios", false);
  });
});

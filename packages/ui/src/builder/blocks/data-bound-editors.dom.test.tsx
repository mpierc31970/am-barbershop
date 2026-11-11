// @vitest-environment jsdom
// Hours, Social and Map editors + Suggested picker clicks (07-24; CONT-24, CONT-27, D119,
// D-UI-P7-12; choices 3, 8, 10).
import { MAP_SHORT_LINK_COPY } from "@cds/core/content";
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, mount, typeInto, type Mounted } from "../../test-support/dom";
import { BlockTemplatePicker, type BlockChoice } from "../BlockTemplatePicker";
import {
  BuilderBusinessProvider,
  type BuilderBusiness,
} from "./business-context";
import { HoursEditor } from "./HoursEditor";
import { MapEditor } from "./MapEditor";
import { SocialEditor } from "./SocialEditor";
import type { CoreBlockEditorProps } from "./types";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const BUSINESS: BuilderBusiness = {
  name: "Rivera Bakery",
  phone: "512-555-0100",
  addressText: "12 Main St, Austin, TX 78701",
  hasHours: true,
  socials: [
    { platform: "instagram", url: "https://instagram.com/rivera" },
    { platform: "facebook", url: "https://facebook.com/rivera" },
  ],
  businessType: "bakery",
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

function withBusiness(ui: ReactNode, value: BuilderBusiness | null = BUSINESS) {
  return <BuilderBusinessProvider value={value}>{ui}</BuilderBusinessProvider>;
}

function blur(el: Element | null) {
  act(() => {
    el!.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

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

describe("MapEditor", () => {
  const content = { heading: "Find us", location: "", show_directions: true };

  it("leaves the address empty with the business address as placeholder", () => {
    const { p } = props(content);
    mounted = mount(withBusiness(<MapEditor {...p} />));
    const input = byLabel(mounted.container, "Address");
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("12 Main St, Austin, TX 78701");
    expect(mounted.container.textContent).toContain(
      "Leave blank to use your business address: 12 Main St, Austin, TX 78701",
    );
    expect(mounted.container.textContent).not.toContain(
      "Add your address in Settings",
    );
  });

  it("parses a pasted Maps link on blur and says what it found", () => {
    const { p, onChange } = props(content);
    mounted = mount(withBusiness(<MapEditor {...p} />));
    const input = byLabel(mounted.container, "Address");
    typeInto(
      input,
      "https://www.google.com/maps/place/Rivera+Bakery/@30.26,-97.74,17z",
    );
    expect(onChange).not.toHaveBeenCalled();
    blur(input);
    expect(onChange).toHaveBeenCalledWith("location", "Rivera Bakery");
    expect(mounted.container.textContent).toContain("Found: Rivera Bakery");
  });

  it("refuses a short link with the core copy, content unchanged", () => {
    const { p, onChange } = props(content);
    mounted = mount(withBusiness(<MapEditor {...p} />));
    const input = byLabel(mounted.container, "Address");
    typeInto(input, "https://maps.app.goo.gl/x");
    blur(input);
    expect(mounted.container.textContent).toContain(MAP_SHORT_LINK_COPY);
    expect(onChange).not.toHaveBeenCalled();
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("no address anywhere: info alert linking to Business info", () => {
    const { p } = props(content);
    mounted = mount(
      withBusiness(<MapEditor {...p} />, { ...BUSINESS, addressText: "" }),
    );
    expect(mounted.container.textContent).toContain(
      "Add your address in Settings › Business info, or type one here.",
    );
    expect(
      mounted.container.querySelector('a[href="/hub/settings?tab=business"]'),
    ).not.toBeNull();
  });

  it("toggles Get directions", () => {
    const { p, onChange } = props(content);
    mounted = mount(withBusiness(<MapEditor {...p} />));
    click(byLabel(mounted.container, 'Show "Get directions"'));
    expect(onChange).toHaveBeenCalledWith("show_directions", false);
  });
});

describe("SocialEditor", () => {
  const content = {
    heading: "",
    show_socials: true,
    show_share: true,
    share: ["facebook", "x", "email", "copy"],
  };

  it("shows six share checkboxes with the content's targets checked", () => {
    const { p } = props(content);
    mounted = mount(withBusiness(<SocialEditor {...p} />));
    const boxes = [
      ...mounted.container.querySelectorAll<HTMLInputElement>(
        'fieldset input[type="checkbox"]',
      ),
    ];
    expect(boxes.map((b) => b.parentElement!.textContent)).toEqual([
      "Facebook",
      "X",
      "LinkedIn",
      "Pinterest",
      "Email",
      "Copy link",
    ]);
    expect(boxes.map((b) => b.checked)).toEqual([
      true,
      true,
      false,
      false,
      true,
      true,
    ]);
  });

  it("toggling LinkedIn keeps canonical order", () => {
    const { p, onChange } = props(content);
    mounted = mount(withBusiness(<SocialEditor {...p} />));
    click(byLabel(mounted.container, "LinkedIn"));
    expect(onChange).toHaveBeenCalledWith("share", [
      "facebook",
      "x",
      "linkedin",
      "email",
      "copy",
    ]);
  });

  it("share off hides the checkboxes", () => {
    const { p } = props({ ...content, show_share: false });
    mounted = mount(withBusiness(<SocialEditor {...p} />));
    expect(mounted.container.querySelector("fieldset")).toBeNull();
  });

  it("lists the connected platforms and links to Business info", () => {
    const { p } = props(content);
    mounted = mount(withBusiness(<SocialEditor {...p} />));
    expect(mounted.container.textContent).toContain(
      "Showing Instagram and Facebook",
    );
    expect(
      mounted.container.querySelector('a[href="/hub/settings?tab=business"]'),
    ).not.toBeNull();
    expect(mounted.container.textContent).not.toContain(
      "Add social links in Settings › Business info, or turn on share buttons.",
    );
  });

  it("no socials and share off: the empty-state alert", () => {
    const { p } = props({ ...content, show_share: false });
    mounted = mount(
      withBusiness(<SocialEditor {...p} />, { ...BUSINESS, socials: [] }),
    );
    expect(mounted.container.textContent).toContain(
      "Add social links in Settings › Business info, or turn on share buttons.",
    );
  });
});

describe("HoursEditor", () => {
  const content = { heading: "Opening hours", show_open_now: true };

  it("points to Team & hours", () => {
    const { p } = props(content);
    mounted = mount(withBusiness(<HoursEditor {...p} />));
    expect(mounted.container.textContent).toContain(
      "Hours come from Settings › Team & hours.",
    );
    const link = mounted.container.querySelector(
      'a[href="/hub/settings?tab=team-hours"]',
    );
    expect(link?.textContent).toBe("Edit your hours");
    expect(mounted.container.textContent).not.toContain("No hours yet.");
  });

  it("no hours: says what visitors will see", () => {
    const { p } = props(content);
    mounted = mount(
      withBusiness(<HoursEditor {...p} />, { ...BUSINESS, hasHours: false }),
    );
    expect(mounted.container.textContent).toContain(
      "No hours yet. Visitors will see 'Contact us for hours.'",
    );
  });

  it("toggles Open now", () => {
    const { p, onChange } = props(content);
    mounted = mount(withBusiness(<HoursEditor {...p} />));
    click(byLabel(mounted.container, 'Show "Open now"'));
    expect(onChange).toHaveBeenCalledWith("show_open_now", false);
  });

  it("renders outside the provider", () => {
    const { p } = props(content);
    mounted = mount(<HoursEditor {...p} />);
    expect(mounted.container.textContent).toContain("Edit your hours");
  });
});

describe("BlockTemplatePicker Suggested (07-24)", () => {
  function tile(root: HTMLElement, title: string): HTMLButtonElement {
    const b = [...root.querySelectorAll("button")].find((x) =>
      x.textContent?.startsWith(title),
    );
    if (!b) throw new Error(`no tile ${title}`);
    return b;
  }

  it("Contact form and map hands back two blocks in order", () => {
    const onPick =
      vi.fn<(c: BlockChoice, more?: readonly BlockChoice[]) => void>();
    mounted = mount(
      <BlockTemplatePicker
        onPick={onPick}
        onExit={() => {}}
        presetContext={{ addressText: "12 Main St", formId: "frm1" }}
      />,
    );
    click(tile(mounted.container, "Contact form and map"));
    expect(onPick).toHaveBeenCalledTimes(1);
    const [first, more] = onPick.mock.calls[0]!;
    expect(first.section_type).toBe("columns");
    expect(first.row_layout).toBe("60-40");
    expect(more?.map((m) => m.section_type)).toEqual(["map"]);
  });

  it("a single-block preset passes no extra blocks", () => {
    const onPick = vi.fn();
    mounted = mount(<BlockTemplatePicker onPick={onPick} onExit={() => {}} />);
    click(tile(mounted.container, "Three features"));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0]![1]).toBeUndefined();
  });
});

// @vitest-environment jsdom
// WindowForm + ScopePicker (13-36 Task 1; STAFF-10, D100, D-UI-P13-6; WINDOW-RANGE).
import { P13_COPY } from "@cds/core/staff";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  click,
  flush,
  mount,
  submit,
  typeInto,
  type Mounted,
} from "../../test-support/dom";
import { WINDOWS_COPY, WindowForm, type WindowFormProps } from "./index";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const TZ = "America/Chicago";
// Thu 15 Oct 2026, 14:00 Central.
const NOW = new Date("2026-10-15T19:00:00Z");
const ORG = "abcdefghijklmno";
const PAGE = "pagepagepage001";

function props(over: Partial<WindowFormProps> = {}): WindowFormProps {
  return {
    allowed: { platform: false, addon: false },
    sites: [{ id: ORG, name: "Rivera Bakery" }],
    addons: [{ slug: "events", name: "Events" }],
    incidents: [{ code: "I-3", title: "Image uploads failing" }],
    loadTargets: vi.fn(async () => ({
      ok: true as const,
      data: { pages: [{ id: PAGE, title: "About us" }], addons: [] },
    })),
    onCreate: vi.fn(async () => ({
      ok: true as const,
      data: { message: "Window W-12 · …", code: "W-12" },
    })),
    timeZone: TZ,
    now: () => NOW,
    ...over,
  };
}

function el<T extends Element>(c: ParentNode, sel: string): T {
  const found = c.querySelector<T>(sel);
  if (!found) throw new Error(`missing ${sel}`);
  return found;
}

function byLabel<T extends Element>(c: HTMLElement, label: string): T {
  const l = Array.from(c.querySelectorAll("label")).find(
    (x) => x.textContent?.trim() === label && x.htmlFor,
  );
  if (!l) throw new Error(`no label ${label}`);
  return el<T>(c, `#${CSS.escape(l.htmlFor)}`);
}

function change(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  )?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("ScopePicker", () => {
  it("an agent sees Add-on and Platform disabled with Super Admin only, described by it", () => {
    mounted = mount(<WindowForm {...props()} />);
    const c = mounted.container;
    const radios = Array.from(
      c.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    );
    expect(radios.map((r) => r.value)).toEqual([
      "page",
      "component",
      "organization",
      "addon",
      "platform",
    ]);
    for (const r of radios) {
      const wide = r.value === "addon" || r.value === "platform";
      expect(r.disabled).toBe(wide);
      const described = (r.getAttribute("aria-describedby") ?? "")
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent ?? "");
      expect(described.includes(P13_COPY.SUPER_ONLY)).toBe(wide);
    }
    expect(c.textContent).toContain(WINDOWS_COPY.scopes.platform);
  });

  it("a super_admin may pick them", () => {
    mounted = mount(
      <WindowForm {...props({ allowed: { platform: true, addon: true } })} />,
    );
    const radios = mounted.container.querySelectorAll<HTMLInputElement>(
      'input[type="radio"]',
    );
    expect(Array.from(radios).every((r) => !r.disabled)).toBe(true);
    expect(mounted.container.textContent).not.toContain(P13_COPY.SUPER_ONLY);
  });
});

describe("WindowForm", () => {
  it("end before start → WINDOW-RANGE, nothing sent", async () => {
    const p = props();
    mounted = mount(<WindowForm {...p} />);
    const c = mounted.container;
    change(byLabel<HTMLSelectElement>(c, WINDOWS_COPY.site), ORG);
    await flush();
    change(byLabel<HTMLSelectElement>(c, WINDOWS_COPY.page), PAGE);
    typeInto(byLabel(c, WINDOWS_COPY.starts), "2026-10-15T16:00");
    typeInto(byLabel(c, WINDOWS_COPY.ends), "2026-10-15T15:00");
    typeInto(byLabel(c, WINDOWS_COPY.message), "Moving the booking page.");
    submit(el(c, "form"));
    await flush();
    expect(c.textContent).toContain(P13_COPY.WINDOW_RANGE);
    expect(p.onCreate).not.toHaveBeenCalled();
  });

  it("more than 7 days → WINDOW-RANGE", async () => {
    const p = props({ sites: [] });
    mounted = mount(<WindowForm {...p} />);
    const c = mounted.container;
    typeInto(byLabel(c, WINDOWS_COPY.ends), "2026-10-23T15:00");
    submit(el(c, "form"));
    await flush();
    expect(c.textContent).toContain(P13_COPY.WINDOW_RANGE);
  });

  it("161 characters → the counter error; the counter is always visible", async () => {
    const p = props();
    mounted = mount(<WindowForm {...p} />);
    const c = mounted.container;
    expect(c.textContent).toContain("0 / 160");
    typeInto(byLabel(c, WINDOWS_COPY.message), "x".repeat(161));
    expect(c.textContent).toContain("161 / 160");
    submit(el(c, "form"));
    await flush();
    expect(c.textContent).toContain(WINDOWS_COPY.messageTooLong(160));
    expect(p.onCreate).not.toHaveBeenCalled();
  });

  it("the preview strip shows the message (active now) and the page title", async () => {
    mounted = mount(<WindowForm {...props()} />);
    const c = mounted.container;
    change(byLabel<HTMLSelectElement>(c, WINDOWS_COPY.site), ORG);
    await flush();
    change(byLabel<HTMLSelectElement>(c, WINDOWS_COPY.page), PAGE);
    typeInto(byLabel(c, WINDOWS_COPY.message), "Moving the booking page.");
    const preview = el(c, "[data-window-preview]");
    expect(preview.textContent).toContain("Moving the booking page.");
    expect(preview.textContent).toContain("About us");
    expect(c.textContent).toContain(
      WINDOWS_COPY.previewOn("the About us page editor"),
    );
  });

  it("Tonight sets 10 pm → 2 am Central; a valid form sends ISO times and the incident code", async () => {
    const p = props();
    const created = vi.fn();
    mounted = mount(<WindowForm {...p} onCreated={created} />);
    const c = mounted.container;
    change(byLabel<HTMLSelectElement>(c, WINDOWS_COPY.site), ORG);
    await flush();
    change(byLabel<HTMLSelectElement>(c, WINDOWS_COPY.page), PAGE);
    const tonight = Array.from(c.querySelectorAll("button")).find(
      (b) => b.textContent === "Tonight 10 pm–2 am",
    );
    click(tonight);
    expect(byLabel<HTMLInputElement>(c, WINDOWS_COPY.starts).value).toBe(
      "2026-10-15T22:00",
    );
    expect(byLabel<HTMLInputElement>(c, WINDOWS_COPY.ends).value).toBe(
      "2026-10-16T02:00",
    );
    typeInto(byLabel(c, WINDOWS_COPY.message), "Moving the booking page.");
    change(byLabel<HTMLSelectElement>(c, WINDOWS_COPY.incident), "I-3");
    submit(el(c, "form"));
    await flush();
    expect(p.onCreate).toHaveBeenCalledWith({
      scope: "page",
      orgId: ORG,
      pageId: PAGE,
      startsAt: "2026-10-16T03:00:00.000Z",
      endsAt: "2026-10-16T07:00:00.000Z",
      message: "Moving the booking page.",
      incident: "I-3",
    });
    expect(created).toHaveBeenCalledWith({
      message: "Window W-12 · …",
      code: "W-12",
    });
    // Planned: the preview is the upcoming strip.
    expect(el(c, "[data-window-preview]").textContent).toContain(
      "Moving the booking page.",
    );
  });

  it("a refusal keeps the inputs and shows the message", async () => {
    const p = props({
      onCreate: vi.fn(async () => ({
        ok: false as const,
        code: "forbidden",
        message: P13_COPY.REFUSED_ROLE,
      })),
    });
    mounted = mount(<WindowForm {...p} />);
    const c = mounted.container;
    change(byLabel<HTMLSelectElement>(c, WINDOWS_COPY.site), ORG);
    await flush();
    change(byLabel<HTMLSelectElement>(c, WINDOWS_COPY.page), PAGE);
    typeInto(byLabel(c, WINDOWS_COPY.message), "Keep me");
    submit(el(c, "form"));
    await flush();
    expect(c.textContent).toContain(P13_COPY.REFUSED_ROLE);
    expect(byLabel<HTMLTextAreaElement>(c, WINDOWS_COPY.message).value).toBe(
      "Keep me",
    );
  });
});

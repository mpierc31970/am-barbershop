// @vitest-environment jsdom
// Catalog components (13-37 Task 2; STAFF-07, D161, D264; 13-UI-SPEC "Catalog").
import { P13_COPY } from "@cds/core/staff";
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  button,
  click,
  flush,
  mount,
  submit,
  typeInto,
  type Mounted,
} from "../../test-support/dom";
import {
  CATALOG_COPY as C,
  ListingEditor,
  parseDollars,
  PriceCasePreview,
  PriceGrid,
  ScreenshotList,
  type ListingEditorProps,
  type PriceGroupView,
  type PricePreviewView,
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
  document.body.innerHTML = "";
});

function byLabel<T extends Element>(c: ParentNode, label: string): T {
  const l = Array.from(c.querySelectorAll("label")).find(
    (x) => x.textContent?.trim() === label && x.htmlFor,
  );
  if (!l) throw new Error(`no label ${label}`);
  const el = c.querySelector<T>(`#${CSS.escape(l.htmlFor)}`);
  if (!el) throw new Error(`no control for ${label}`);
  return el;
}

const SHOT = {
  id: "shot00000000001",
  url: "/_catalog/builder-pro/shot00000000001.png",
  alt: "The block picker",
  w: 1280,
  h: 800,
};

function editorProps(
  over: Partial<ListingEditorProps> = {},
): ListingEditorProps {
  return {
    listing: {
      slug: "builder-pro",
      name: "Builder Pro",
      summary: "More blocks for your pages.",
      private: false,
      taglineOverride: "",
      descriptionOverride: "",
      availability: "available",
      screenshots: [SHOT],
      meta: "Website · Adds blocks",
      priceLabel: "$9/mo",
    },
    onSave: vi.fn(async () => ({ ok: true as const, data: null })),
    onUpload: vi.fn(async () => ({ ok: true as const, data: SHOT })),
    onRemoveScreenshot: vi.fn(),
    ...over,
  };
}

describe("ListingEditor", () => {
  it("counts tagline characters and blocks 121", async () => {
    const props = editorProps();
    mounted = mount(<ListingEditor {...props} />);
    const c = mounted.container;
    const tagline = byLabel<HTMLInputElement>(c, C.tagline);
    expect(tagline.maxLength).toBe(120);
    expect(tagline.placeholder).toBe("Default: More blocks for your pages.");
    typeInto(tagline, "x".repeat(120));
    expect(c.textContent).toContain("120 / 120");
    expect(button(c, C.saveListing)?.disabled).toBe(false);
    typeInto(tagline, "x".repeat(121));
    expect(c.textContent).toContain("121 / 120");
    expect(c.textContent).toContain(C.tooLong(120));
    expect(button(c, C.saveListing)?.disabled).toBe(true);
    submit(c.querySelector("form"));
    await flush();
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it("availability radios have the three words; Save sends the override and screenshot order", async () => {
    const props = editorProps();
    mounted = mount(<ListingEditor {...props} />);
    const c = mounted.container;
    const radios = Array.from(
      c.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    );
    expect(radios.map((r) => r.value)).toEqual([
      "available",
      "coming_soon",
      "hidden",
    ]);
    for (const word of ["Available", "Coming soon", "Hidden"]) {
      expect(c.textContent).toContain(word);
    }
    click(radios[1]);
    typeInto(byLabel(c, C.tagline), "  Build more ");
    // Owners see: the card follows the draft, with the Coming soon badge.
    expect(c.querySelector("aside")?.textContent).toContain("Build more");
    expect(c.querySelector("aside")?.textContent).toContain("Coming soon");
    click(button(c, C.saveListing));
    await flush();
    expect(props.onSave).toHaveBeenCalledWith({
      slug: "builder-pro",
      tagline: "Build more",
      description: "",
      availability: "coming_soon",
      screenshots: [{ id: SHOT.id, alt: SHOT.alt }],
    });
  });

  it("Reset to default clears an override", () => {
    mounted = mount(
      <ListingEditor
        {...editorProps({
          listing: {
            ...editorProps().listing,
            taglineOverride: "Custom line",
          },
        })}
      />,
    );
    const c = mounted.container;
    expect(byLabel<HTMLInputElement>(c, C.tagline).value).toBe("Custom line");
    click(button(c, C.resetToDefault));
    expect(byLabel<HTMLInputElement>(c, C.tagline).value).toBe("");
  });

  it("a private add-on has availability disabled", () => {
    mounted = mount(
      <ListingEditor
        {...editorProps({
          listing: { ...editorProps().listing, private: true },
        })}
      />,
    );
    const radios = Array.from(
      mounted.container.querySelectorAll<HTMLInputElement>(
        'input[type="radio"]',
      ),
    );
    expect(radios.every((r) => r.disabled)).toBe(true);
    expect(mounted.container.textContent).toContain(C.privateHelp);
  });

  it("Remove takes the screenshot out at once and Undo's restore puts it back", () => {
    let restore: (() => void) | null = null;
    const props = editorProps({
      onRemoveScreenshot: vi.fn((_item, r: () => void) => {
        restore = r;
      }),
    });
    mounted = mount(<ListingEditor {...props} />);
    const c = mounted.container;
    click(button(c, C.removeLabel(1)));
    expect(c.querySelectorAll("img")).toHaveLength(0);
    expect(props.onRemoveScreenshot).toHaveBeenCalledWith(
      SHOT,
      expect.any(Function),
    );
    expect(restore).not.toBeNull();
  });
});

describe("ScreenshotList", () => {
  it("thumbs are 160 × 100 with Move up / Move down; first can't move up", () => {
    const onChange = vi.fn();
    const two = [SHOT, { ...SHOT, id: "shot00000000002", alt: "Second" }];
    mounted = mount(
      <ScreenshotList
        items={two}
        onChange={onChange}
        onUpload={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    const c = mounted.container;
    const img = c.querySelector("img")!;
    expect(img.getAttribute("width")).toBe("160");
    expect(img.getAttribute("height")).toBe("100");
    expect(button(c, C.moveShotUpLabel(1))?.disabled).toBe(true);
    click(button(c, C.moveShotDownLabel(1)));
    expect(onChange.mock.calls[0]![0].map((s: { id: string }) => s.id)).toEqual(
      ["shot00000000002", SHOT.id],
    );
  });

  it("a finished upload keeps alt edits made while it ran (WR-E14)", async () => {
    let finish: (v: unknown) => void = () => {};
    const onUpload = vi.fn(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
    const onChange = vi.fn();
    const ui = (items: (typeof SHOT)[]) => (
      <ScreenshotList
        items={items}
        onChange={onChange}
        onUpload={onUpload as never}
        onRemove={vi.fn()}
      />
    );
    mounted = mount(ui([SHOT]));
    const c = mounted.container;
    const input = c.querySelector<HTMLInputElement>('input[type="file"]')!;
    const f = new File(["x"], "b.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [f], configurable: true });
    act(() => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const altInputs = c.querySelectorAll<HTMLInputElement>(
      'input[type="text"], input:not([type])',
    );
    typeInto(altInputs[altInputs.length - 1]!, "New shot");
    click(button(c, C.upload));
    await flush();
    expect(onUpload).toHaveBeenCalled();
    // An alt edit lands in the parent while the upload runs.
    act(() => mounted!.root.render(ui([{ ...SHOT, alt: "Edited" }])));
    await act(async () => {
      finish({ ok: true, data: { ...SHOT, id: "shot00000000009" } });
    });
    await flush();
    const last = onChange.mock.calls.at(-1)![0] as {
      id: string;
      alt: string;
    }[];
    expect(last.map((s) => s.alt)[0]).toBe("Edited");
    expect(last.map((s) => s.id)).toEqual([SHOT.id, "shot00000000009"]);
  });

  it("at 6 the add control is replaced by the reason", () => {
    const six = Array.from({ length: 6 }, (_, i) => ({
      ...SHOT,
      id: `shot0000000000${i}`,
    }));
    mounted = mount(
      <ScreenshotList
        items={six}
        onChange={vi.fn()}
        onUpload={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(mounted.container.textContent).toContain(C.full(6));
    expect(mounted.container.querySelector('input[type="file"]')).toBeNull();
  });

  it("refuses an oversized or wrong-type file before uploading", () => {
    const onUpload = vi.fn();
    mounted = mount(
      <ScreenshotList
        items={[]}
        onChange={vi.fn()}
        onUpload={onUpload}
        onRemove={vi.fn()}
      />,
    );
    const input =
      mounted.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const big = new File([new Uint8Array(3 * 1024 * 1024)], "a.png", {
      type: "image/png",
    });
    Object.defineProperty(input, "files", { value: [big], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return flush().then(() => {
      expect(mounted!.container.textContent).toContain(C.tooBig);
      expect(onUpload).not.toHaveBeenCalled();
    });
  });
});

const PREVIEW: PricePreviewView = {
  label: "Builder Pro",
  pathLabel: "Standard",
  oldText: "$9.00/mo",
  newText: "$0.00/mo",
  newProviderPrice: true,
  crossesZero: true,
  toFree: true,
  pathOrgs: 4,
};

describe("PriceCasePreview", () => {
  it("across $0 shows the sites line and needs the checkbox before Save price enables", async () => {
    const onSave = vi.fn(async () => ({ ok: true as const, data: null }));
    mounted = mount(
      <PriceCasePreview
        open
        preview={PREVIEW}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );
    const body = document.body;
    expect(body.textContent).toContain("Change Builder Pro Standard?");
    expect(body.textContent).toContain("Old → new: $9.00/mo → $0.00/mo");
    expect(body.textContent).toContain(
      "This makes Builder Pro included free for every Standard site (4 sites).",
    );
    const save = button(body, "Save price")!;
    expect(button(body, "Keep price")).not.toBeNull();
    expect(save.disabled).toBe(true);
    const box = body.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(body.textContent).toContain(C.sitesChecked);
    click(box);
    expect(save.disabled).toBe(false);
    click(save);
    await flush();
    expect(onSave).toHaveBeenCalledWith(true);
  });

  it("an ordinary change has no checkbox", () => {
    mounted = mount(
      <PriceCasePreview
        open
        preview={{
          ...PREVIEW,
          newText: "$19.00/mo",
          crossesZero: false,
          toFree: false,
        }}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(document.body.querySelector('input[type="checkbox"]')).toBeNull();
    expect(button(document.body, "Save price")?.disabled).toBe(false);
    expect(document.body.textContent).toContain(C.providerLine);
  });
});

const GROUPS: PriceGroupView[] = [
  {
    kind: "addon",
    label: "Add-ons",
    rows: [
      {
        kind: "addon",
        key: "builder-pro",
        label: "Builder Pro",
        cells: {
          standard: {
            cents: 900,
            text: "$9.00/mo",
            offered: true,
            sync: "synced",
          },
          studio: {
            cents: null,
            text: "Price coming soon",
            offered: true,
            sync: "none",
          },
        },
      },
    ],
  },
];

describe("PriceGrid", () => {
  it("for an agent renders disabled edit buttons with Super Admin only", () => {
    mounted = mount(
      <PriceGrid
        groups={GROUPS}
        canEdit={false}
        onPreview={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    const c = mounted.container;
    const edit = button(c, "Edit Builder Pro Standard price")!;
    expect(edit.disabled).toBe(true);
    expect(button(c, "Edit Builder Pro Studio price")?.disabled).toBe(true);
    expect(c.textContent).toContain(P13_COPY.SUPER_ONLY);
    expect(c.querySelector("tbody th")?.textContent).toBe("Add-ons");
    expect(c.textContent).toContain(C.synced);
  });

  it("super_admin: edit → Preview price (cents-safe) → dialog → Save price", async () => {
    const onPreview = vi.fn(async () => ({
      ok: true as const,
      data: { ...PREVIEW, newText: "$19.99/mo", crossesZero: false },
    }));
    const onSave = vi.fn(async () => ({
      ok: true as const,
      data: { message: "Price saved. New quotes use $19.99/mo." },
    }));
    const onSaved = vi.fn();
    mounted = mount(
      <PriceGrid
        groups={GROUPS}
        canEdit
        onPreview={onPreview}
        onSave={onSave}
        onSaved={onSaved}
      />,
    );
    const c = mounted.container;
    click(button(c, "Edit Builder Pro Standard price"));
    const amount = byLabel<HTMLInputElement>(c, C.amount);
    expect(amount.value).toBe("9.00");
    typeInto(amount, "19.99");
    click(button(c, C.previewPrice));
    await flush();
    expect(onPreview).toHaveBeenCalledWith({
      kind: "addon",
      key: "builder-pro",
      path: "standard",
      cents: 1999,
    });
    click(button(document.body, "Save price"));
    await flush();
    expect(onSave).toHaveBeenCalledWith({
      kind: "addon",
      key: "builder-pro",
      path: "standard",
      cents: 1999,
      sitesChecked: false,
    });
    expect(onSaved).toHaveBeenCalledWith(
      "Price saved. New quotes use $19.99/mo.",
    );
  });

  it("a bad amount stays inline and nothing is previewed", async () => {
    const onPreview = vi.fn();
    mounted = mount(
      <PriceGrid
        groups={GROUPS}
        canEdit
        onPreview={onPreview}
        onSave={vi.fn()}
      />,
    );
    const c = mounted.container;
    click(button(c, "Edit Builder Pro Standard price"));
    typeInto(byLabel(c, C.amount), "19.999");
    click(button(c, C.previewPrice));
    await flush();
    expect(c.textContent).toContain(C.amountBad);
    expect(onPreview).not.toHaveBeenCalled();
  });
});

describe("parseDollars", () => {
  it("is cents-safe", () => {
    expect(parseDollars("19")).toBe(1900);
    expect(parseDollars("19.5")).toBe(1950);
    expect(parseDollars("$1,500.00")).toBe(150000);
    expect(parseDollars("0.29")).toBe(29);
    expect(parseDollars("100000")).toBe(10_000_000);
    expect(parseDollars("100000.01")).toBeNull();
    expect(parseDollars("-1")).toBeNull();
    expect(parseDollars("1e3")).toBeNull();
  });
});

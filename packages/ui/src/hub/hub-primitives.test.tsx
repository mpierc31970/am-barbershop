// Hub primitives render contract (03-05, UI-SPEC "Hub primitives", "Accessibility contract").
// Rendered with react-dom/server in the node unit project: no jsdom, so these tests pin
// the markup and a11y attributes, and the behaviour lives in the human checks (03-16).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { EmptyState, InlineAlert, Skeleton } from "./feedback";
import { Select, TextArea, TextField } from "./fields";
import { IconButton } from "./IconButton";
import { RadioCardGroup } from "./RadioCardGroup";
import { Switch } from "./Switch";
import { ALL_LAYOUTS, COLUMN_COUNT } from "@cds/core/content";
import { Dialog } from "./Dialog";
import { Drawer } from "./Drawer";
import * as hub from "./index";
import { LayoutThumb } from "./LayoutThumb";
import { TabLinks } from "./TabLinks";
import {
  pushToast,
  TOAST_MS,
  toastDuration,
  ToastRegion,
  UNDO_TOAST_MS,
} from "./Toast";

const html = (node: ReactElement) => renderToStaticMarkup(node);

describe("Button", () => {
  it("loading sets aria-busy, shows the loading label and disables the button", () => {
    const out = html(
      <Button loading loadingLabel="Saving…">
        Save block
      </Button>,
    );
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain("Saving…");
    expect(out).toMatch(/<button[^>]*disabled/);
  });

  it("defaults to type=button so it never submits a form by accident", () => {
    expect(html(<Button>Add block</Button>)).toContain('type="button"');
  });

  it("primary is the only variant using the accent fill", () => {
    expect(html(<Button variant="primary">Publish</Button>)).toContain(
      "bg-hub-accent",
    );
    for (const v of ["secondary", "ghost", "destructive"] as const) {
      expect(html(<Button variant={v}>x</Button>)).not.toContain(
        "bg-hub-accent ",
      );
    }
    expect(html(<Button variant="destructive">Delete</Button>)).toContain(
      "bg-hub-danger",
    );
  });

  it("sm is 32px, md is 40px", () => {
    expect(html(<Button size="sm">x</Button>)).toContain("h-8");
    expect(html(<Button>x</Button>)).toContain("h-10");
  });
});

describe("IconButton", () => {
  it("uses label as aria-label and a visible tooltip", () => {
    const out = html(
      <IconButton label="Delete Hero block" icon={<svg aria-hidden />} />,
    );
    expect(out).toContain('aria-label="Delete Hero block"');
    expect(out).toContain('role="tooltip"');
    expect(out).toContain("pointer-coarse:");
  });

  it("lines the tooltip up with a row edge on request (03-UI-REVIEW Fix 6)", () => {
    const icon = <svg aria-hidden />;
    expect(html(<IconButton label="x" icon={icon} />)).toContain(
      "left-1/2 -translate-x-1/2",
    );
    const start = html(
      <IconButton label="x" icon={icon} tooltipAlign="start" />,
    );
    expect(start).toContain("left-0");
    expect(start).not.toContain("-translate-x-1/2");
    expect(
      html(<IconButton label="x" icon={icon} tooltipAlign="end" />),
    ).toContain("right-0");
  });

  it("drag handles, More actions and Open menu show their tooltip (03-UI-SPEC)", () => {
    const files = [
      "../builder/SectionsList.tsx",
      "../builder/ColumnsEditor.tsx",
      "../builder/ItemListEditor.tsx",
      "../../../../apps/web/app/(platform)/hub/HubShell.tsx",
      "../../../../apps/web/app/(platform)/hub/website/PopupList.tsx",
    ];
    for (const f of files) {
      const src = readFileSync(
        fileURLToPath(new URL(f, import.meta.url)),
        "utf8",
      );
      expect(src, f).not.toContain("hideTooltip");
    }
  });

  it("requires a label at the type level", () => {
    // @ts-expect-error label is required
    const el = <IconButton icon={<svg aria-hidden />} />;
    expect(el).toBeTruthy();
  });
});

describe("TextField / TextArea / Select", () => {
  it("links label, helper and error; marks invalid", () => {
    const out = html(
      <TextField
        id="slug"
        label="Address"
        helper="Lowercase letters and hyphens."
        error="Use lowercase letters, numbers and hyphens, like /our-story."
      />,
    );
    expect(out).toContain('for="slug"');
    expect(out).toContain('id="slug"');
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('aria-describedby="slug-helper slug-error"');
    expect(out).toContain('id="slug-helper"');
    expect(out).toContain('id="slug-error"');
  });

  it("no error means no aria-invalid", () => {
    const out = html(<TextField id="t" label="Title" />);
    expect(out).not.toContain("aria-invalid");
    expect(out).not.toContain("aria-describedby");
  });

  it("renders a counter as value / max", () => {
    const out = html(
      <TextArea id="msg" label="Message" counter={{ value: 38, max: 140 }} />,
    );
    expect(out).toContain("38 / 140");
    expect(out).toContain("<textarea");
  });

  it("Select renders native options", () => {
    const out = html(
      <Select
        id="pop"
        label="Pop-up"
        options={[
          { value: "a", label: "Spring offer" },
          { value: "b", label: "Newsletter" },
        ]}
      />,
    );
    expect(out).toContain("<select");
    expect(out).toContain('<option value="a">Spring offer</option>');
    expect(out).toContain('for="pop"');
  });
});

describe("Switch", () => {
  it("is a checkbox with role=switch and its label", () => {
    const out = html(
      <Switch id="on" label="Show banner" checked onChange={() => {}} />,
    );
    expect(out).toContain('type="checkbox"');
    expect(out).toContain('role="switch"');
    expect(out).toContain("Show banner");
    expect(out).toContain('for="on"');
  });
});

describe("RadioCardGroup", () => {
  it("renders a fieldset with legend and one radio per option", () => {
    const out = html(
      <RadioCardGroup
        name="trigger"
        legend="When it appears"
        value="delay"
        onChange={() => {}}
        options={[
          { value: "delay", title: "After a delay" },
          { value: "exit", title: "When leaving", description: "Desktop only" },
        ]}
      />,
    );
    expect(out).toContain("<fieldset");
    expect(out).toContain("<legend");
    expect(out.match(/type="radio"/g)).toHaveLength(2);
    expect(out).toContain('name="trigger"');
    expect(out).toContain("Desktop only");
  });
});

describe("Badge", () => {
  it("changes renders its text with the warning tone", () => {
    const out = html(<Badge tone="changes">Unpublished changes</Badge>);
    expect(out).toContain("Unpublished changes");
    expect(out).toContain("text-hub-warning");
    expect(out).toContain("bg-hub-warning-tint");
  });

  it("hidden carries an icon plus text, never colour alone", () => {
    const out = html(<Badge tone="hidden">Hidden</Badge>);
    expect(out).toContain("<svg");
    expect(out).toContain("Hidden");
  });

  it("published uses the success tone", () => {
    expect(html(<Badge tone="published">Published</Badge>)).toContain(
      "text-hub-success",
    );
  });

  it("08-09 being-built is neutral: ink-muted on hub-surface-2, text only", () => {
    const out = html(<Badge tone="being-built">Being built</Badge>);
    expect(out).toContain("Being built");
    expect(out).toContain("bg-hub-surface-2");
    expect(out).toContain("text-hub-ink-muted");
    expect(out).not.toContain("<svg");
    expect(out).not.toContain("hub-accent");
  });
});

describe("feedback", () => {
  it("InlineAlert error is role=alert; info is not", () => {
    expect(html(<InlineAlert tone="error">Not saved.</InlineAlert>)).toContain(
      'role="alert"',
    );
    expect(
      html(<InlineAlert tone="info">Column 3 moved.</InlineAlert>),
    ).not.toContain('role="alert"');
  });

  it("EmptyState renders heading and body", () => {
    const out = html(
      <EmptyState
        heading="No pages yet"
        body="Add your first page."
        action={<Button variant="primary">Add page</Button>}
      />,
    );
    expect(out).toContain("No pages yet");
    expect(out).toContain("Add your first page.");
    expect(out).toContain("Add page");
  });

  it("Skeleton draws the requested rows, hidden from assistive tech", () => {
    const out = html(<Skeleton rows={4} />);
    expect(out.match(/data-skeleton-row/g)).toHaveLength(4);
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain("bg-hub-surface-2");
  });

  it("Skeleton rows on a surface-2 pane use the border token so they stay visible", () => {
    const out = html(<Skeleton rows={3} ground="surface-2" />);
    expect(out.match(/data-skeleton-row/g)).toHaveLength(3);
    expect(out).toContain("bg-hub-border");
    expect(out).not.toContain("bg-hub-surface-2");
  });
});

describe("LayoutThumb", () => {
  it.each(ALL_LAYOUTS)(
    "%s draws COLUMN_COUNT bars proportional to its ratios",
    (layout) => {
      const out = html(<LayoutThumb layout={layout} />);
      const grows = [...out.matchAll(/flex-grow:(\d+)/g)].map((m) =>
        Number(m[1]),
      );
      expect(grows).toHaveLength(COLUMN_COUNT[layout]);
      const expected =
        layout === "full" ? [100] : layout.split("-").map(Number);
      expect(grows).toEqual(expected);
    },
  );

  it("is an image with a readable label, drawn not loaded", () => {
    const out = html(<LayoutThumb layout="25-75" />);
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="25/75 layout"');
    expect(out).not.toContain("<img");
  });

  it("selected fills bars with the accent; default does not", () => {
    expect(html(<LayoutThumb layout="50-50" selected />)).toContain(
      "bg-hub-accent",
    );
    expect(html(<LayoutThumb layout="50-50" />)).not.toContain("bg-hub-accent");
  });

  it("md is 48x32, sm is 24x16", () => {
    expect(html(<LayoutThumb layout="full" />)).toContain("width:48px");
    expect(html(<LayoutThumb layout="full" />)).toContain("height:32px");
    const sm = html(<LayoutThumb layout="full" size="sm" />);
    expect(sm).toContain("width:24px");
    expect(sm).toContain("height:16px");
  });

  it("a visible label replaces the aria-label", () => {
    const out = html(<LayoutThumb layout="33-33-33" label="33/33/33" />);
    expect(out).toContain("33/33/33");
    expect(out).not.toContain('role="img"');
  });
});

describe("TabLinks", () => {
  const TABS = [
    { id: "pages", label: "Pages", href: "/hub/website?tab=pages" },
    { id: "banner", label: "Banner", href: "/hub/website?tab=banner" },
    { id: "popups", label: "Pop-ups", href: "/hub/website?tab=popups" },
  ] as const;

  it("renders real links with exactly one aria-current=page", () => {
    const out = html(<TabLinks tabs={TABS} activeId="banner" />);
    expect(out.match(/<a /g)).toHaveLength(3);
    for (const t of TABS) expect(out).toContain(`href="${t.href}"`);
    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
    expect(out).toMatch(/aria-current="page"[^>]*>Banner|>Banner</);
  });
});

describe("Dialog and Drawer", () => {
  it("Dialog is a native dialog labelled by its title", () => {
    const out = html(
      <Dialog
        open={false}
        onClose={() => {}}
        title="Delete the Spring offer pop-up?"
        footer={<Button>Keep pop-up</Button>}
      >
        It stops showing on your site right away.
      </Dialog>,
    );
    expect(out).toContain("<dialog");
    const labelledBy = out.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(labelledBy).toBeTruthy();
    expect(out).toContain(`id="${labelledBy}"`);
    expect(out).toContain("Delete the Spring offer pop-up?");
  });

  it("Drawer is a native dialog with an accessible label", () => {
    const out = html(
      <Drawer open={false} onClose={() => {}} label="Menu">
        nav
      </Drawer>,
    );
    expect(out).toContain("<dialog");
    expect(out).toContain('aria-label="Menu"');
    expect(out).toContain("w-72");
  });
});

describe("Toast", () => {
  it("exports the 6s and 8s durations", () => {
    expect(TOAST_MS).toBe(6000);
    expect(UNDO_TOAST_MS).toBe(8000);
  });

  it("an Undo toast defaults to 8s, a plain toast to 6s", () => {
    expect(toastDuration({ message: "Page created." })).toBe(TOAST_MS);
    expect(
      toastDuration({
        message: "Hero block deleted.",
        action: { label: "Undo", onClick: () => {} },
      }),
    ).toBe(UNDO_TOAST_MS);
    expect(toastDuration({ message: "x", durationMs: 3000 })).toBe(3000);
  });

  it("keeps at most 3 toasts, dropping the oldest", () => {
    let list: { id: number; message: string }[] = [];
    for (let i = 1; i <= 5; i++)
      list = pushToast(list, { id: i, message: `t${i}` });
    expect(list.map((t) => t.id)).toEqual([3, 4, 5]);
  });

  it("the region is a role=status live region", () => {
    const out = html(
      <ToastRegion>
        <p>app</p>
      </ToastRegion>,
    );
    expect(out).toContain('role="status"');
    expect(out).toContain("app");
  });
});

describe("barrel", () => {
  it("exports every primitive", () => {
    for (const name of [
      "Button",
      "IconButton",
      "TextField",
      "TextArea",
      "Select",
      "Switch",
      "RadioCardGroup",
      "Badge",
      "InlineAlert",
      "EmptyState",
      "Skeleton",
      "ToastRegion",
      "useToast",
      "Dialog",
      "Drawer",
      "TabLinks",
      "LayoutThumb",
    ]) {
      expect(typeof (hub as Record<string, unknown>)[name]).toBe("function");
    }
  });
});

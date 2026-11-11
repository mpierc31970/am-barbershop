// @vitest-environment jsdom
// Testimonials block form: the "How many" field (B-WR-08; 05-UI-SPEC "Builder integration").
import { act, useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mount,
  typeInto,
  type Mounted,
} from "../../../ui/src/test-support/dom";
import { BlockForm, parseLimit, settleLimit } from "./BlockForm";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

function render(initial: Record<string, unknown>) {
  const changes: [string, unknown][] = [];
  function Host() {
    const [content, setContent] = useState(initial);
    return (
      <BlockForm
        content={content}
        errors={{}}
        editHref="/hub/website?tab=testimonials"
        onChange={(name, value) => {
          changes.push([name, value]);
          setContent((c) => ({ ...c, [name]: value }));
        }}
      />
    );
  }
  mounted = mount(<Host />);
  const input = mounted.container.querySelector<HTMLInputElement>(
    'input[type="number"]',
  )!;
  return { input, changes };
}

function blur(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

describe("Testimonials block form: How many (B-WR-08)", () => {
  it("clearing the field to type a single digit keeps the digit", () => {
    const { input, changes } = render({ layout: "grid", limit: 6 });
    expect(input.value).toBe("6");
    typeInto(input, "");
    expect(input.value).toBe("");
    typeInto(input, "3");
    expect(input.value).toBe("3");
    expect(changes).toEqual([["limit", 3]]);
  });

  it("typing through an out-of-range value sends nothing until it is in range", () => {
    const { input, changes } = render({ layout: "grid", limit: 6 });
    typeInto(input, "1");
    typeInto(input, "10");
    expect(input.value).toBe("10");
    expect(changes).toEqual([
      ["limit", 1],
      ["limit", 10],
    ]);
    typeInto(input, "100");
    expect(input.value).toBe("100");
    expect(changes).toHaveLength(2);
    blur(input);
    expect(input.value).toBe("12");
    expect(changes.at(-1)).toEqual(["limit", 12]);
  });

  it("an empty field settles to the default on blur", () => {
    const { input, changes } = render({ layout: "grid", limit: 3 });
    typeInto(input, "");
    blur(input);
    expect(input.value).toBe("6");
    expect(changes).toEqual([["limit", 6]]);
  });

  it("parseLimit and settleLimit", () => {
    expect(parseLimit("")).toBeNull();
    expect(parseLimit("0")).toBeNull();
    expect(parseLimit("13")).toBeNull();
    expect(parseLimit("2.5")).toBeNull();
    expect(parseLimit("12")).toBe(12);
    expect(settleLimit("")).toBe(6);
    expect(settleLimit("0")).toBe(1);
    expect(settleLimit("99")).toBe(12);
    expect(settleLimit("2.6")).toBe(3);
  });
});

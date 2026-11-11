// DOM test helpers for jsdom unit tests (03-REVIEW Part C). Test-only: nothing in the
// package entry points imports this file. A test opts in with the
// `// @vitest-environment jsdom` docblock; the node unit project stays the default.
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

export interface Mounted {
  container: HTMLElement;
  root: Root;
  unmount: () => void;
}

export function mount(ui: ReactNode): Mounted {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return {
    container,
    root,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** Let pending promises and the React updates they cause settle. */
export async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

export function click(el: Element | null | undefined): void {
  if (!el) throw new Error("click: element not found");
  act(() => {
    (el as HTMLElement).click();
  });
}

/** Set an input's value the way React's onChange sees it. */
export function typeInto(el: Element | null | undefined, value: string): void {
  if (!el) throw new Error("typeInto: element not found");
  const input = el as HTMLInputElement | HTMLTextAreaElement;
  const proto = Object.getPrototypeOf(input) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The first button whose accessible name (aria-label or text) matches. */
export function button(
  root: ParentNode,
  name: string | RegExp,
): HTMLButtonElement | null {
  const all = Array.from(root.querySelectorAll("button"));
  return (
    all.find((b) => {
      const label = b.getAttribute("aria-label") ?? b.textContent ?? "";
      return typeof name === "string"
        ? label.trim() === name
        : name.test(label);
    }) ?? null
  );
}

export function submit(form: Element | null | undefined): void {
  if (!form) throw new Error("submit: form not found");
  act(() => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

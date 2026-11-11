// @vitest-environment jsdom
// Phase 6 review Part C: the step/Settings save scope (StageFrame's useSaveScope).
//   C-CR-01  leaving while a save is pending sends it and waits for it before navigating.
//   C-WR-01  a field that unmounts clears its invalid flag.
import type { HubActionResult } from "@cds/ui/hub";
import { act, type ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  flush,
  mount,
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";

vi.mock("../app/actions/intake", () => ({
  dismissFirstVisitAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/hub/setup/contact",
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));

const { NavGuardProvider, useNavGuard } =
  await import("../app/(platform)/hub/nav-guard");
const {
  useSaveScope,
  SaveScopeProvider,
  LeaveGuardDialog,
  useStageAutosave,
  LEAVE_TITLE,
  LEAVE_WAIT_MS,
} = await import("../app/(platform)/hub/setup/[stage]/StageFrame");

type Save = (v: string) => Promise<HubActionResult<unknown>>;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

let guard!: ReturnType<typeof useNavGuard>;
let fields: Record<string, (v: string) => void> = {};

function Field({
  name,
  save,
  debounceMs,
}: {
  name: string;
  save: Save;
  debounceMs?: number;
}) {
  const auto = useStageAutosave<string>(name, save, { debounceMs });
  fields[name] = auto.run;
  return null;
}

function Scope({ children }: { children: ReactNode }) {
  const scope = useSaveScope();
  guard = useNavGuard();
  return (
    <SaveScopeProvider scope={scope}>
      <p data-testid="state">{scope.state}</p>
      {children}
      <LeaveGuardDialog scope={scope} />
    </SaveScopeProvider>
  );
}

function show(children: ReactNode): Mounted {
  return mount(
    <NavGuardProvider>
      <Scope>{children}</Scope>
    </NavGuardProvider>,
  );
}

let mounted: Mounted | null = null;
beforeAll(() => {
  // jsdom has <dialog> but not the modal API; open/close by attribute is enough here.
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
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  fields = {};
  vi.useRealTimers();
});

describe("save scope: leaving with a pending save (C-CR-01)", () => {
  it("with nothing pending, navigation proceeds at once", () => {
    mounted = show(<Field name="hours" save={vi.fn()} />);
    const go = vi.fn();
    expect(guard.intercept(go)).toBe(false);
  });

  it("a value waiting on the debounce is sent now, and the navigation runs after it saves", async () => {
    const d = deferred<HubActionResult<unknown>>();
    const save = vi.fn<Save>().mockReturnValue(d.promise);
    mounted = show(<Field name="hours" save={save} debounceMs={800} />);
    act(() => fields.hours!("mon 9-5"));
    expect(save).not.toHaveBeenCalled();
    const go = vi.fn();
    let took = false;
    act(() => {
      took = guard.intercept(go);
    });
    expect(took).toBe(true);
    expect(save).toHaveBeenCalledWith("mon 9-5");
    await flush();
    expect(go).not.toHaveBeenCalled();
    d.resolve({ ok: true, data: null });
    await flush();
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("a value queued behind a save in flight goes out before the navigation runs", async () => {
    const first = deferred<HubActionResult<unknown>>();
    const save = vi
      .fn<Save>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue({ ok: true, data: null });
    mounted = show(<Field name="phone" save={save} />);
    act(() => fields.phone!("A"));
    act(() => fields.phone!("B"));
    const go = vi.fn();
    act(() => {
      guard.intercept(go);
    });
    first.resolve({ ok: true, data: null });
    await flush();
    expect(save.mock.calls.map((c) => c[0])).toEqual(["A", "B"]);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("a save that fails while leaving keeps the owner on the step (Try again shows)", async () => {
    const save = vi
      .fn<Save>()
      .mockResolvedValue({ ok: false, code: "save_failed", message: "x" });
    mounted = show(<Field name="hours" save={save} debounceMs={800} />);
    act(() => fields.hours!("mon 9-5"));
    const go = vi.fn();
    act(() => {
      guard.intercept(go);
    });
    await flush();
    expect(go).not.toHaveBeenCalled();
    expect(
      mounted.container.querySelector('[data-testid="state"]')?.textContent,
    ).toBe("error");
  });

  it("a value the server refuses while leaving opens the leave dialog", async () => {
    const save = vi.fn<Save>().mockResolvedValue({
      ok: false,
      code: "invalid_input",
      message: "Too long.",
    });
    mounted = show(<Field name="tagline" save={save} debounceMs={800} />);
    act(() => fields.tagline!("x".repeat(500)));
    const go = vi.fn();
    act(() => {
      guard.intercept(go);
    });
    await flush();
    expect(go).not.toHaveBeenCalled();
    const dialog = document.querySelector("dialog");
    expect(dialog?.hasAttribute("open")).toBe(true);
    expect(dialog?.textContent).toContain(LEAVE_TITLE);
  });

  it("a field whose save already failed asks before leaving (R2-WR-03)", async () => {
    const save = vi
      .fn<Save>()
      .mockResolvedValue({ ok: false, code: "save_failed", message: "x" });
    mounted = show(<Field name="hours" save={save} />);
    act(() => fields.hours!("mon 9-5"));
    await flush();
    expect(
      mounted.container.querySelector('[data-testid="state"]')?.textContent,
    ).toBe("error");
    const go = vi.fn();
    let took = false;
    act(() => {
      took = guard.intercept(go);
    });
    expect(took).toBe(true);
    await flush();
    expect(go).not.toHaveBeenCalled();
    const dialog = document.querySelector("dialog");
    expect(dialog?.hasAttribute("open")).toBe(true);
    expect(dialog?.textContent).toContain(LEAVE_TITLE);
  });

  it("a failed field edited again that fails again still asks (R2-WR-03)", async () => {
    const save = vi
      .fn<Save>()
      .mockResolvedValue({ ok: false, code: "save_failed", message: "x" });
    mounted = show(<Field name="hours" save={save} debounceMs={800} />);
    act(() => fields.hours!("mon 9-5"));
    await act(async () => {
      guard.intercept(vi.fn());
    });
    await flush();
    // Close the first ask, edit again, and leave: the new value fails too.
    act(() => {
      (
        [...document.querySelectorAll("dialog button")].find((b) =>
          /keep editing/i.test(b.textContent ?? ""),
        ) as HTMLButtonElement | undefined
      )?.click();
    });
    act(() => fields.hours!("mon 9-6"));
    const go = vi.fn();
    act(() => {
      guard.intercept(go);
    });
    await flush();
    expect(save.mock.calls.map((c) => c[0])).toContain("mon 9-6");
    expect(go).not.toHaveBeenCalled();
    expect(document.querySelector("dialog")?.hasAttribute("open")).toBe(true);
  });

  it("a save that never answers stops blocking after LEAVE_WAIT_MS", async () => {
    vi.useFakeTimers();
    const save = vi
      .fn<Save>()
      .mockReturnValue(new Promise<HubActionResult<unknown>>(() => {}));
    mounted = show(<Field name="hours" save={save} debounceMs={800} />);
    act(() => fields.hours!("mon 9-5"));
    const go = vi.fn();
    act(() => {
      guard.intercept(go);
    });
    await act(async () => {
      vi.advanceTimersByTime(LEAVE_WAIT_MS - 1);
    });
    expect(go).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(go).toHaveBeenCalledTimes(1);
  });
});

describe("save scope: a field that leaves (C-WR-01)", () => {
  it("takes its refused state with it: the header clears and leaving no longer asks", async () => {
    const save = vi.fn<Save>().mockResolvedValue({
      ok: false,
      code: "invalid_input",
      message: "Too long.",
    });
    const tree = (withField: boolean) => (
      <NavGuardProvider>
        <Scope>{withField ? <Field name="tagline" save={save} /> : null}</Scope>
      </NavGuardProvider>
    );
    mounted = mount(tree(true));
    act(() => fields.tagline!("x".repeat(500)));
    await flush();
    const state = () =>
      mounted!.container.querySelector('[data-testid="state"]')?.textContent;
    expect(state()).toBe("invalid");
    act(() => mounted!.root.render(tree(false)));
    expect(state()).toBe("idle");
    expect(guard.intercept(vi.fn())).toBe(false);
  });
});

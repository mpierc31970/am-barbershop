// @vitest-environment jsdom
// 06-18 Task 2: StageRail, StillNeededList, AutosaveStatus and useAutosave (06-UI-SPEC
// "Setup overview", "Stages" frame and autosave contract, Accessibility "Setup"; ONB-02).
import type { NeededItem } from "@cds/core/intake";
import { act, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutosaveStatus, SAVED_SETTLE_MS } from "./AutosaveStatus";
import { StageRail, type StageRailItem } from "./StageRail";
import { NOTHING_LEFT_COPY, StillNeededList } from "./StillNeededList";
import {
  useAutosave,
  type Autosave,
  type AutosaveOptions,
} from "./useAutosave";
import type { HubActionResult } from "./addon-types";
import { button, click, flush, mount, type Mounted } from "../test-support/dom";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

const STAGES: StageRailItem[] = [
  ["business", "Your business", "done"],
  ["contact", "Contact & hours", "started"],
  ["email", "Email", "not_started"],
  ["words", "Your words & services", "not_started"],
  ["people", "People & proof", "not_started"],
  ["look", "Photos & look", "not_started"],
  ["the-rest", "Domain & the rest", "not_started"],
].map(([slug, name, status]) => ({
  slug: slug!,
  name: name!,
  status: status as StageRailItem["status"],
  href: `/hub/setup/${slug}`,
}));

describe("StageRail", () => {
  it("is a Setup steps nav with seven links and aria-current on the current step", () => {
    mounted = mount(<StageRail stages={STAGES} current="contact" />);
    const nav = mounted.container.querySelector(
      'nav[aria-label="Setup steps"]',
    );
    expect(nav).not.toBeNull();
    const steps = nav!.querySelectorAll("ol a");
    expect(steps).toHaveLength(7);
    const current = nav!.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0]!.getAttribute("href")).toBe("/hub/setup/contact");
  });

  it("gives every status icon a hidden word and links All steps", () => {
    mounted = mount(<StageRail stages={STAGES} current="contact" />);
    const text = mounted.container.textContent ?? "";
    expect(text).toContain("Done: Your business");
    expect(text).toContain("Started: Contact & hours");
    expect(text).toContain("Not started: Email");
    const all = Array.from(mounted.container.querySelectorAll("a")).filter(
      (a) => a.textContent?.trim() === "All steps",
    );
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(all[0]!.getAttribute("href")).toBe("/hub/setup");
  });

  it("shows Step N of 7 for the narrow layout", () => {
    mounted = mount(<StageRail stages={STAGES} current="email" />);
    expect(mounted.container.textContent).toContain("Step 3 of 7");
  });
});

function item(
  fieldId: string,
  stage: NeededItem["stage"],
  label: string,
  ownerText?: string,
): NeededItem {
  return {
    fieldId,
    stage,
    label,
    href: `/hub/setup/${stage}#field-${fieldId}`,
    ...(ownerText ? { ownerText } : {}),
  };
}

describe("StillNeededList", () => {
  it("lists must-haves with a Needed badge, linking to the field", () => {
    mounted = mount(
      <StillNeededList
        required={[item("contact", "contact", "Business phone or email")]}
        optional={[]}
        footer={<p>foot</p>}
      />,
    );
    const root = mounted.container;
    expect(root.querySelector("h2")?.textContent).toBe("What's still needed");
    expect(root.textContent).toContain("Must-haves");
    const link = root.querySelector(
      'a[href="/hub/setup/contact#field-contact"]',
    );
    expect(link?.textContent).toBe("Business phone or email · Contact & hours");
    expect(root.textContent).toContain("Needed");
    expect(root.textContent).toContain("foot");
  });

  it("says what happens when an optional item stays empty", () => {
    mounted = mount(
      <StillNeededList
        required={[]}
        optional={[
          item(
            "logo",
            "business",
            "Logo",
            "Leave empty and we'll show your business name in your site's font.",
          ),
        ]}
        footer={null}
      />,
    );
    const root = mounted.container;
    expect(root.textContent).toContain("Optional");
    expect(root.textContent).toContain("Logo · Your business");
    expect(root.textContent).toContain(
      "Leave empty and we'll show your business name in your site's font.",
    );
    expect(root.textContent).not.toContain("Must-haves");
  });

  it("collapses optional rows after 5 behind Show N more", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      item(`f${i}`, "the-rest", `Item ${i}`, "x"),
    );
    mounted = mount(
      <StillNeededList required={[]} optional={many} footer={null} />,
    );
    const root = mounted.container;
    expect(root.querySelectorAll("li")).toHaveLength(5);
    click(button(root, "Show 7 more"));
    expect(root.querySelectorAll("li")).toHaveLength(12);
    expect(button(root, /Show \d+ more/)).toBeNull();
  });

  it("shows the nothing-left line when everything is in", () => {
    mounted = mount(
      <StillNeededList required={[]} optional={[]} footer={null} />,
    );
    expect(mounted.container.textContent).toContain(NOTHING_LEFT_COPY);
    expect(NOTHING_LEFT_COPY).toBe("Everything's in. CDS has what it needs.");
  });
});

describe("AutosaveStatus", () => {
  it("is one role=status region, silent when idle", () => {
    mounted = mount(<AutosaveStatus state="idle" />);
    const status = mounted.container.querySelectorAll('[role="status"]');
    expect(status).toHaveLength(1);
    expect(status[0]!.textContent).toBe("");
  });

  it("reads Saving…, then Saved, then All changes saved after 3 s", () => {
    vi.useFakeTimers();
    mounted = mount(<AutosaveStatus state="saving" />);
    expect(mounted.container.textContent).toBe("Saving…");
    act(() => mounted!.root.render(<AutosaveStatus state="saved" />));
    expect(mounted.container.textContent).toBe("Saved");
    act(() => {
      vi.advanceTimersByTime(SAVED_SETTLE_MS);
    });
    expect(mounted.container.textContent).toBe("All changes saved");
  });

  it("reads Not saved with a Try again that retries", () => {
    const onRetry = vi.fn();
    mounted = mount(<AutosaveStatus state="error" onRetry={onRetry} />);
    expect(mounted.container.textContent).toContain("Not saved.");
    click(button(mounted.container, "Try again"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("counts fields that need attention", () => {
    mounted = mount(<AutosaveStatus state="invalid" />);
    expect(mounted.container.textContent).toBe("1 field needs attention");
    act(() =>
      mounted!.root.render(<AutosaveStatus state="invalid" invalidCount={2} />),
    );
    expect(mounted.container.textContent).toBe("2 fields need attention");
  });
});

type Patch = Record<string, unknown>;

function Probe({
  save,
  opts,
  onApi,
}: {
  save: (v: Patch) => Promise<HubActionResult<unknown>>;
  opts?: AutosaveOptions<Patch>;
  onApi: (api: Autosave<Patch>) => void;
}) {
  const api = useAutosave(save, opts);
  useEffect(() => {
    onApi(api);
  });
  return <p data-status={api.status}>{api.status}</p>;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("useAutosave", () => {
  it("saves at once by default and reports saved", async () => {
    const save = vi.fn(async () => ({ ok: true as const, data: null }));
    let api!: Autosave<Patch>;
    mounted = mount(<Probe save={save} onApi={(a) => (api = a)} />);
    act(() => api.run({ phone: "1" }));
    await flush();
    expect(save).toHaveBeenCalledWith({ phone: "1" });
    expect(mounted.container.textContent).toBe("saved");
  });

  it("never saves while a save is in flight; queued values merge", async () => {
    const first = deferred<HubActionResult<unknown>>();
    const save = vi
      .fn<(v: Patch) => Promise<HubActionResult<unknown>>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue({ ok: true, data: null });
    let api!: Autosave<Patch>;
    mounted = mount(
      <Probe
        save={save}
        opts={{ merge: (a, b) => ({ ...a, ...b }) }}
        onApi={(a) => (api = a)}
      />,
    );
    act(() => api.run({ a: 1 }));
    act(() => api.run({ b: 2 }));
    act(() => api.run({ c: 3 }));
    expect(save).toHaveBeenCalledTimes(1);
    expect(mounted.container.textContent).toBe("saving");
    first.resolve({ ok: true, data: null });
    await flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![0]).toEqual({ b: 2, c: 3 });
    expect(mounted.container.textContent).toBe("saved");
  });

  it("debounces when asked", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => ({ ok: true as const, data: null }));
    let api!: Autosave<Patch>;
    mounted = mount(
      <Probe save={save} opts={{ debounceMs: 800 }} onApi={(a) => (api = a)} />,
    );
    act(() => api.run({ v: 1 }));
    act(() => api.run({ v: 2 }));
    expect(save).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ v: 2 });
  });

  it("B-WR-05: leaving within the debounce window still saves the pending value", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => ({ ok: true as const, data: null }));
    let api!: Autosave<Patch>;
    mounted = mount(
      <Probe save={save} opts={{ debounceMs: 800 }} onApi={(a) => (api = a)} />,
    );
    act(() => api.run({ hours: "9-5" }));
    expect(save).not.toHaveBeenCalled();
    act(() => mounted!.unmount());
    mounted = null;
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ hours: "9-5" });
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("B-WR-05: a value queued behind a save in flight still goes out after unmount", async () => {
    const first = deferred<HubActionResult<unknown>>();
    const save = vi
      .fn<(v: Patch) => Promise<HubActionResult<unknown>>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue({ ok: true, data: null });
    let api!: Autosave<Patch>;
    mounted = mount(<Probe save={save} onApi={(a) => (api = a)} />);
    act(() => api.run({ a: 1 }));
    act(() => api.run({ b: 2 }));
    act(() => mounted!.unmount());
    mounted = null;
    first.resolve({ ok: true, data: null });
    await flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![0]).toEqual({ b: 2 });
  });

  it("B-WR-05: pagehide and a hidden tab save the pending value at once", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => ({ ok: true as const, data: null }));
    let api!: Autosave<Patch>;
    mounted = mount(
      <Probe save={save} opts={{ debounceMs: 800 }} onApi={(a) => (api = a)} />,
    );
    act(() => api.run({ v: 1 }));
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(save).toHaveBeenCalledWith({ v: 1 });
    act(() => api.run({ v: 2 }));
    const vis = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    vis.mockRestore();
    await act(async () => {
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalledWith({ v: 2 });
  });

  it("an error can be retried; an invalid value is not", async () => {
    const save = vi
      .fn<(v: Patch) => Promise<HubActionResult<unknown>>>()
      .mockResolvedValueOnce({ ok: false, code: "save_failed", message: "x" })
      .mockResolvedValueOnce({ ok: true, data: null })
      .mockResolvedValueOnce({
        ok: false,
        code: "invalid_input",
        message: "That doesn't look like a phone number.",
      });
    let api!: Autosave<Patch>;
    mounted = mount(<Probe save={save} onApi={(a) => (api = a)} />);
    act(() => api.run({ phone: "1" }));
    await flush();
    expect(mounted.container.textContent).toBe("error");
    act(() => api.retry());
    await flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![0]).toEqual({ phone: "1" });
    expect(mounted.container.textContent).toBe("saved");
    act(() => api.run({ phone: "x" }));
    await flush();
    expect(mounted.container.textContent).toBe("invalid");
    expect(api.failure?.message).toBe("That doesn't look like a phone number.");
    act(() => api.retry());
    await flush();
    expect(save).toHaveBeenCalledTimes(3);
  });
});

// @vitest-environment jsdom
// 12-17 Task 1 (COMM-11, D102; UI-SPEC "Locks and held changes"): an autosave refused with
// target_locked parks the pending change through onLocked once, is never retried and reports
// "paused" ("Editing paused"); other failures keep the existing retry behaviour.
import { act, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTOSAVE_PAUSED_COPY, AutosaveStatus } from "./AutosaveStatus";
import {
  LOCKED_CODE,
  useAutosave,
  type Autosave,
  type AutosaveOptions,
} from "./useAutosave";
import type { HubActionResult } from "./addon-types";
import { flush, mount, type Mounted } from "../test-support/dom";

type Patch = Record<string, unknown>;

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

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
  return (
    <p data-status={api.status} data-busy={String(api.busy)}>
      {api.status}
    </p>
  );
}

const busyOf = (m: Mounted) =>
  m.container.querySelector("p")?.getAttribute("data-busy");

async function wait(ms: number) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const LOCKED: HubActionResult<unknown> = {
  ok: false,
  code: LOCKED_CODE,
  message: "You can look around, but changes are paused.",
};

describe("useAutosave target_locked (12-17)", () => {
  it("calls onLocked once with the pending payload and stops retrying", async () => {
    const save = vi.fn(async () => LOCKED);
    const onLocked = vi.fn();
    const onFailed = vi.fn();
    let api!: Autosave<Patch>;
    mounted = mount(
      <Probe
        save={save}
        opts={{ onLocked, onFailed }}
        onApi={(a) => (api = a)}
      />,
    );
    act(() => api.run({ title: "New" }));
    await flush();
    expect(onLocked).toHaveBeenCalledTimes(1);
    expect(onLocked.mock.calls[0]![0]).toEqual({ title: "New" });
    expect(onLocked.mock.calls[0]![1]).toMatchObject({ code: LOCKED_CODE });
    expect(onFailed).not.toHaveBeenCalled();
    expect(mounted.container.textContent).toBe("paused");
    // retry() has nothing to re-send: the change is parked, not failed.
    act(() => api.retry());
    await flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(onLocked).toHaveBeenCalledTimes(1);
  });

  it("folds values queued behind the locked save into one pending change", async () => {
    const first = deferred<HubActionResult<unknown>>();
    const save = vi
      .fn<(v: Patch) => Promise<HubActionResult<unknown>>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue({ ok: true, data: null });
    const onLocked = vi.fn();
    let api!: Autosave<Patch>;
    mounted = mount(
      <Probe
        save={save}
        opts={{ onLocked, merge: (a, b) => ({ ...a, ...b }) }}
        onApi={(a) => (api = a)}
      />,
    );
    act(() => api.run({ a: 1 }));
    act(() => api.run({ b: 2 }));
    first.resolve(LOCKED);
    await flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(onLocked).toHaveBeenCalledTimes(1);
    expect(onLocked.mock.calls[0]![0]).toEqual({ a: 1, b: 2 });
    expect(mounted.container.textContent).toBe("paused");
  });

  it("other failures keep the existing retry behaviour", async () => {
    const save = vi
      .fn<(v: Patch) => Promise<HubActionResult<unknown>>>()
      .mockResolvedValueOnce({ ok: false, code: "save_failed", message: "x" })
      .mockResolvedValue({ ok: true, data: null });
    const onLocked = vi.fn();
    let api!: Autosave<Patch>;
    mounted = mount(
      <Probe save={save} opts={{ onLocked }} onApi={(a) => (api = a)} />,
    );
    act(() => api.run({ v: 1 }));
    await flush();
    expect(mounted.container.textContent).toBe("error");
    act(() => api.retry());
    await flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![0]).toEqual({ v: 1 });
    expect(onLocked).not.toHaveBeenCalled();
    expect(mounted.container.textContent).toBe("saved");
  });

  it("busy clears after a debounced value queued behind a save goes out (WR-D01)", async () => {
    const first = deferred<HubActionResult<unknown>>();
    const save = vi
      .fn<(v: Patch) => Promise<HubActionResult<unknown>>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue({ ok: true, data: null });
    let api!: Autosave<Patch>;
    mounted = mount(
      <Probe save={save} opts={{ debounceMs: 20 }} onApi={(a) => (api = a)} />,
    );
    act(() => api.run({ a: 1 }));
    await wait(30); // first save starts and hangs
    act(() => api.run({ b: 2 })); // queued + debounce armed
    first.resolve({ ok: true, data: null });
    await flush(); // queued value taken early
    await wait(40); // the old debounce would fire here
    expect(save).toHaveBeenCalledTimes(2);
    expect(mounted.container.textContent).toBe("saved");
    expect(busyOf(mounted)).toBe("false");
  });

  it("locked with no onLocked keeps the pending change for Try again (WR-D01)", async () => {
    const first = deferred<HubActionResult<unknown>>();
    const save = vi
      .fn<(v: Patch) => Promise<HubActionResult<unknown>>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue({ ok: true, data: null });
    const onFailed = vi.fn();
    let api!: Autosave<Patch>;
    mounted = mount(
      <Probe
        save={save}
        opts={{ debounceMs: 20, merge: (a, b) => ({ ...a, ...b }), onFailed }}
        onApi={(a) => (api = a)}
      />,
    );
    act(() => api.run({ a: 1 }));
    await wait(30);
    act(() => api.run({ b: 2 }));
    first.resolve(LOCKED);
    await flush();
    await wait(40);
    expect(save).toHaveBeenCalledTimes(1);
    expect(mounted.container.textContent).toBe("error");
    expect(busyOf(mounted)).toBe("false");
    expect(onFailed.mock.calls[0]![0]).toMatchObject({ code: LOCKED_CODE });
    act(() => api.retry());
    await flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![0]).toEqual({ a: 1, b: 2 });
    expect(mounted.container.textContent).toBe("saved");
  });

  it("AutosaveStatus reads Editing paused", () => {
    mounted = mount(<AutosaveStatus state="paused" />);
    expect(mounted.container.textContent).toBe(AUTOSAVE_PAUSED_COPY);
    expect(AUTOSAVE_PAUSED_COPY).toBe("Editing paused");
  });
});

// @vitest-environment jsdom
// Your profile and alerts parts (11-24; DASH-36, DASH-34; 11-UI-SPEC "Profile" lines 368-401):
// AlertPrefsTable, QuietHoursForm, DevicesList.
import { CORE_ALERT_TYPES, eligibleFor } from "@cds/core/alerts";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  button,
  click,
  flush,
  mount,
  type Mounted,
} from "../../test-support/dom";
import { ToastRegion } from "../Toast";
import {
  AlertPrefsTable,
  DevicesList,
  PROFILE_COPY,
  QuietHoursForm,
  THIS_DEVICE_KEY,
  clockLabel,
  deviceLine,
  halfHourOptions,
  turnOffLabel,
  type DeviceRow,
} from "./index";

let mounted: Mounted | null = null;
function show(ui: React.ReactNode): Mounted {
  mounted = mount(<ToastRegion>{ui}</ToastRegion>);
  return mounted;
}
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
  window.localStorage.clear();
});

const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });

function switchByLabel(root: ParentNode, label: string): HTMLInputElement {
  const inputs = Array.from(
    root.querySelectorAll<HTMLInputElement>('input[role="switch"]'),
  );
  const hit = inputs.find((i) => {
    const aria = i.getAttribute("aria-label");
    if (aria) return aria === label;
    return (
      root.querySelector(`label[for="${CSS.escape(i.id)}"]`)?.textContent ===
      label
    );
  });
  if (!hit) throw new Error(`switch not found: ${label}`);
  return hit;
}

function choose(select: HTMLSelectElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )?.set;
    setter?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("copy helpers", () => {
  it("clock labels and 48 half-hour steps", () => {
    expect(clockLabel("21:00")).toBe("9:00 pm");
    expect(clockLabel("00:30")).toBe("12:30 am");
    expect(clockLabel("12:00")).toBe("12:00 pm");
    const opts = halfHourOptions();
    expect(opts).toHaveLength(48);
    expect(opts[1]).toEqual({ value: "00:30", label: "12:30 am" });
    expect(opts.every((o) => /:(00|30)$/.test(o.value))).toBe(true);
  });

  it("device lines in the business time zone", () => {
    const d = { uaFamily: "iphone", createdAt: "2026-10-09 15:00:00.000Z" };
    expect(deviceLine(d, "America/Chicago")).toBe("iPhone · turned on 9 Oct");
    expect(turnOffLabel(d, "America/Chicago")).toBe(
      "Turn off alerts on iPhone, turned on 9 Oct",
    );
    expect(
      deviceLine(
        { uaFamily: "desktop", createdAt: "2026-09-02T12:00:00Z" },
        "UTC",
      ),
    ).toBe("Computer · turned on 2 Sep");
  });
});

describe("AlertPrefsTable", () => {
  function render(over: Partial<Parameters<typeof AlertPrefsTable>[0]> = {}) {
    const props = {
      types: CORE_ALERT_TYPES,
      initial: {},
      onToggle: vi.fn(() => ok(null)),
      onReset: vi.fn(() =>
        ok({ previous: { "form.message": { email: false } } }),
      ),
      onRestore: vi.fn(() => ok(null)),
      ...over,
    };
    const m = show(<AlertPrefsTable {...props} />);
    return { ...m, props };
  }

  it("the five support types show only with support:read (12-29)", () => {
    const SUPPORT_LABELS = [
      "Support replies to your tickets",
      "Ticket status changes",
      "Messages from Support",
      "Notes from Support",
      "Documents from Support",
    ];
    // A grants-only role has no support:read (P12-P11); the server filters by eligibleFor.
    const grantsOnly = CORE_ALERT_TYPES.filter((t) =>
      eligibleFor({ role: "staff", grants: [] }, t),
    );
    const a = render({ types: grantsOnly });
    for (const label of SUPPORT_LABELS) {
      expect(a.container.textContent).not.toContain(label);
    }
    a.unmount();
    document.body.innerHTML = "";
    mounted = null;
    const owner = CORE_ALERT_TYPES.filter((t) =>
      eligibleFor({ role: "owner", grants: [] }, t),
    );
    const b = render({ types: owner });
    for (const label of SUPPORT_LABELS) {
      expect(b.container.textContent).toContain(label);
    }
  });

  it("table: headers, level groups, Bell always on, Summary has no Phone switch", () => {
    const { container: c } = render();
    const table = c.querySelector("table")!;
    expect(
      Array.from(table.querySelectorAll("thead th")).map((t) => t.textContent),
    ).toEqual(["Alert", "Bell", "Email", "Phone"]);
    expect(
      Array.from(table.querySelectorAll("tbody")).map((b) =>
        b.getAttribute("data-level"),
      ),
    ).toEqual(["urgent", "normal", "summary"]);
    expect(table.textContent).toContain("Collected into one email at 7am");
    const bells = Array.from(
      table.querySelectorAll<HTMLInputElement>('input[id$="-bell"]'),
    );
    expect(bells).toHaveLength(CORE_ALERT_TYPES.length);
    expect(bells.every((b) => b.checked && b.disabled)).toBe(true);
    expect(
      table.querySelector(`label[for="${CSS.escape(bells[0]!.id)}"]`)
        ?.textContent,
    ).toContain("Bell alerts are always on");
    const summaryRow = table.querySelector(
      'tr[data-alert-type="contact.new"]',
    )!;
    expect(summaryRow.querySelector('input[id$="-push"]')).toBeNull();
    expect(summaryRow.textContent).toContain("Not available");
    expect(c.querySelector("h2#alerts")).not.toBeNull();
    expect(c.textContent).toContain(PROFILE_COPY.alertsIntro);
  });

  it("toggling Email calls the action with (type, 'email', false)", async () => {
    const { container: c, props } = render();
    const table = c.querySelector("table")!;
    const email = switchByLabel(table, "New form message by email");
    expect(email.checked).toBe(true);
    click(email);
    await flush();
    expect(props.onToggle).toHaveBeenCalledWith("form.message", "email", false);
    expect(email.checked).toBe(false);
    expect(c.textContent).toContain("Saved");
  });

  it("saved choices show; a failed save offers Try again", async () => {
    const onToggle = vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        code: "save_failed",
        message: "x",
      }),
    );
    const { container: c } = render({
      initial: { "form.message": { push: false } },
      onToggle,
    });
    const table = c.querySelector("table")!;
    const push = switchByLabel(table, "New form message by phone");
    expect(push.checked).toBe(false);
    click(push);
    await flush();
    expect(c.textContent).toContain("Not saved.");
    expect(button(c, "Try again")).not.toBeNull();
  });

  it("SENSITIVE-ON only when the site is in sensitive-practice mode", () => {
    const { container: c } = render({ sensitiveBusiness: "Calm Therapy" });
    expect(c.textContent).toContain(
      "Sensitive-practice mode is on for Calm Therapy, so phone and email alerts never show a client's name or service.",
    );
    mounted?.unmount();
    mounted = null;
    const { container: d } = render();
    expect(d.textContent).not.toContain("Sensitive-practice mode");
  });

  it("Reset to defaults: Toast with Undo restores the previous map", async () => {
    const { container: c, props } = render({
      initial: { "form.message": { email: false } },
    });
    click(button(c, "Reset to defaults"));
    await flush();
    expect(props.onReset).toHaveBeenCalled();
    expect(
      switchByLabel(c.querySelector("table")!, "New form message by email")
        .checked,
    ).toBe(true);
    expect(document.body.textContent).toContain(
      "Alerts reset to the defaults.",
    );
    click(button(document.body, "Undo"));
    await flush();
    expect(props.onRestore).toHaveBeenCalledWith({
      "form.message": { email: false },
    });
    expect(
      switchByLabel(c.querySelector("table")!, "New form message by email")
        .checked,
    ).toBe(false);
  });

  it("Reset waits while a toggle is saving (WR-D04)", async () => {
    let finish: (v: { ok: true; data: null }) => void = () => {};
    const onToggle = vi.fn(
      () =>
        new Promise<{ ok: true; data: null }>((r) => {
          finish = r;
        }),
    );
    const { container: c, props } = render({ onToggle });
    click(
      switchByLabel(c.querySelector("table")!, "New form message by email"),
    );
    await flush();
    const reset = button(c, "Reset to defaults")!;
    expect(reset.disabled).toBe(true);
    click(reset);
    await flush();
    expect(props.onReset).not.toHaveBeenCalled();
    await act(async () => {
      finish({ ok: true, data: null });
    });
    await flush();
    expect(button(c, "Reset to defaults")?.disabled).toBe(false);
  });

  it("a failed Undo keeps the defaults on screen (WR-D04)", async () => {
    const { container: c } = render({
      initial: { "form.message": { email: false } },
      onRestore: vi.fn(() =>
        Promise.resolve({
          ok: false as const,
          code: "save_failed",
          message: "Undo did not save.",
        }),
      ),
    });
    click(button(c, "Reset to defaults"));
    await flush();
    click(button(document.body, "Undo"));
    await flush();
    expect(document.body.textContent).toContain("Undo did not save.");
    expect(
      switchByLabel(c.querySelector("table")!, "New form message by email")
        .checked,
    ).toBe(true);
  });

  it("read-only under impersonation", () => {
    const { container: c, props } = render({ disabled: true });
    const email = switchByLabel(
      c.querySelector("table")!,
      "New form message by email",
    );
    expect(email.disabled).toBe(true);
    expect(button(c, "Reset to defaults")?.disabled).toBe(true);
    expect(props.onToggle).not.toHaveBeenCalled();
  });

  it("small screens get blocks with the same switches", () => {
    const { container: c } = render();
    const blocks = c.querySelector("[data-alert-blocks]")!;
    expect(switchByLabel(blocks, "New form message by email")).toBeTruthy();
    expect(blocks.textContent).toContain("Phone: not available");
  });
});

describe("QuietHoursForm", () => {
  it("30-minute steps, the business time zone, autosave of the whole window", async () => {
    const onSave = vi.fn(() => ok(null));
    const { container: c } = show(
      <QuietHoursForm
        initial={{ on: true, from: "21:00", until: "07:00" }}
        zoneLabel="Central Time"
        onSave={onSave}
      />,
    );
    const selects = Array.from(c.querySelectorAll("select"));
    expect(selects).toHaveLength(2);
    expect(selects[0]!.options).toHaveLength(48);
    expect(selects[0]!.value).toBe("21:00");
    expect(selects[0]!.selectedOptions[0]?.textContent).toBe("9:00 pm");
    expect(selects[1]!.selectedOptions[0]?.textContent).toBe("7:00 am");
    expect(c.textContent).toContain(
      "Times are in Central Time, your business's time zone.",
    );
    choose(selects[0]!, "22:30");
    await flush();
    expect(onSave).toHaveBeenLastCalledWith({
      on: true,
      from: "22:30",
      until: "07:00",
    });
    click(switchByLabel(c, "Hold phone alerts at night"));
    await flush();
    expect(onSave).toHaveBeenLastCalledWith({
      on: false,
      from: "22:30",
      until: "07:00",
    });
    expect(selects[0]!.disabled).toBe(true);
  });
});

describe("DevicesList", () => {
  const devices: DeviceRow[] = [
    {
      id: "aaaaaaaaaaaaaa1",
      uaFamily: "desktop",
      createdAt: "2026-10-01 15:00:00.000Z",
      lastOkAt: "",
      failCount: 0,
    },
    {
      id: "aaaaaaaaaaaaaa2",
      uaFamily: "iphone",
      createdAt: "2026-10-09 15:00:00.000Z",
      lastOkAt: "",
      failCount: 0,
    },
  ];
  const env = (supported: boolean) => () => ({
    family: "desktop" as const,
    standalone: false,
    supported,
    permission: "default" as const,
  });

  it("this device first with its label; Turn off removes it with a toast", async () => {
    window.localStorage.setItem(THIS_DEVICE_KEY, "aaaaaaaaaaaaaa2");
    const onRemove = vi.fn(() => ok({ removed: true }));
    const { container: c } = show(
      <DevicesList
        devices={devices}
        timeZone="America/Chicago"
        publicKey="pk"
        onRemove={onRemove}
        onSave={vi.fn()}
        readEnv={env(true)}
      />,
    );
    const items = Array.from(c.querySelectorAll("li[data-device]"));
    expect(items[0]?.textContent).toContain("iPhone · turned on 9 Oct");
    expect(items[0]?.textContent).toContain("This device");
    // This device is on the list: no Turn on button.
    expect(button(c, "Turn on alerts on this device")).toBeNull();
    click(button(c, "Turn off alerts on iPhone, turned on 9 Oct"));
    await flush();
    expect(onRemove).toHaveBeenCalledWith("aaaaaaaaaaaaaa2");
    expect(c.querySelectorAll("li[data-device]")).toHaveLength(1);
    expect(document.body.textContent).toContain(
      "Alerts turned off for that device.",
    );
  });

  it("empty: DEVICES-EMPTY; Turn on alerts on this device saves and remembers it", async () => {
    const subscribe = vi.fn(async (_k: string, save: (s: never) => unknown) => {
      await save({
        endpoint: "https://push.example.com/x",
        keys: { p256dh: "p", auth: "a" },
        uaFamily: "desktop",
      } as never);
      return "on" as const;
    });
    const onSave = vi.fn(async () => ({ ok: true, id: "bbbbbbbbbbbbbb1" }));
    const onTurnedOn = vi.fn();
    const { container: c } = show(
      <DevicesList
        devices={[]}
        timeZone="America/Chicago"
        publicKey="pk"
        onRemove={vi.fn()}
        onSave={onSave}
        onTurnedOn={onTurnedOn}
        readEnv={env(true)}
        subscribe={subscribe}
      />,
    );
    expect(c.textContent).toContain(PROFILE_COPY.devicesEmpty);
    click(button(c, "Turn on alerts on this device"));
    await flush();
    expect(subscribe).toHaveBeenCalled();
    expect(onSave).toHaveBeenCalled();
    expect(window.localStorage.getItem(THIS_DEVICE_KEY)).toBe(
      "bbbbbbbbbbbbbb1",
    );
    expect(onTurnedOn).toHaveBeenCalled();
    expect(c.textContent).toContain("This device");
    expect(button(c, "Turn on alerts on this device")).toBeNull();
  });

  it("no button without push support, without keys, or under impersonation", () => {
    const base = {
      devices: [] as DeviceRow[],
      timeZone: "UTC",
      onRemove: vi.fn(),
      onSave: vi.fn(),
    };
    const { container: a } = show(
      <DevicesList {...base} publicKey="pk" readEnv={env(false)} />,
    );
    expect(button(a, "Turn on alerts on this device")).toBeNull();
    mounted?.unmount();
    const { container: b } = show(
      <DevicesList {...base} publicKey={null} readEnv={env(true)} />,
    );
    expect(button(b, "Turn on alerts on this device")).toBeNull();
    mounted?.unmount();
    const { container: d } = show(
      <DevicesList {...base} publicKey="pk" disabled readEnv={env(true)} />,
    );
    expect(button(d, "Turn on alerts on this device")).toBeNull();
  });

  it("a denied prompt shows the warning", async () => {
    const { container: c } = show(
      <DevicesList
        devices={[]}
        timeZone="UTC"
        publicKey="pk"
        onRemove={vi.fn()}
        onSave={vi.fn()}
        readEnv={env(true)}
        subscribe={async () => "denied"}
      />,
    );
    click(button(c, "Turn on alerts on this device"));
    await flush();
    expect(c.textContent).toContain(PROFILE_COPY.pushDenied);
  });
});

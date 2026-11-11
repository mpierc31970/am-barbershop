// @vitest-environment jsdom
// 06-22 Task 1: EmailRouteRow (06-UI-SPEC "Email routing" item 5, Badge table, BOUNCE;
// ONB-09, D173, T-06-102).
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EmailRouteRow,
  RESEND_CONFIRM_COOLDOWN_MS,
  bounceCopy,
} from "./EmailRouteRow";
import { button, click, flush, mount, type Mounted } from "../test-support/dom";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

const ADDR = "orders@riverabakery.com";

describe("EmailRouteRow", () => {
  it("waiting: address, the Waiting for confirmation badge and Resend confirmation", () => {
    mounted = mount(
      <EmailRouteRow
        address={ADDR}
        status="waiting"
        onResend={async () => true}
      />,
    );
    const c = mounted.container;
    expect(c.textContent).toContain(ADDR);
    expect(c.textContent).toContain("Waiting for confirmation");
    expect(button(c, "Resend confirmation")).not.toBeNull();
    expect(c.querySelector('[role="alert"]')).toBeNull();
  });

  it("resend: disabled for 60 s reading 'Sent. Check that inbox.', then ready again", async () => {
    vi.useFakeTimers();
    const onResend = vi.fn(async () => true);
    mounted = mount(
      <EmailRouteRow address={ADDR} status="waiting" onResend={onResend} />,
    );
    const c = mounted.container;
    click(button(c, "Resend confirmation"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(onResend).toHaveBeenCalledTimes(1);
    const sent = button(c, "Sent. Check that inbox.");
    expect(sent).not.toBeNull();
    expect(sent!.disabled).toBe(true);
    click(sent);
    expect(onResend).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(RESEND_CONFIRM_COOLDOWN_MS - 1);
    });
    expect(button(c, "Sent. Check that inbox.")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(button(c, "Resend confirmation")!.disabled).toBe(false);
    expect(RESEND_CONFIRM_COOLDOWN_MS).toBe(60_000);
  });

  it("a failed resend leaves the button ready (no cooldown)", async () => {
    mounted = mount(
      <EmailRouteRow
        address={ADDR}
        status="waiting"
        onResend={async () => false}
      />,
    );
    click(button(mounted.container, "Resend confirmation"));
    await flush();
    expect(button(mounted.container, "Resend confirmation")!.disabled).toBe(
      false,
    );
  });

  it("confirmed: the Confirmed badge and no action", () => {
    mounted = mount(
      <EmailRouteRow
        address={ADDR}
        status="confirmed"
        onResend={async () => true}
      />,
    );
    const c = mounted.container;
    expect(c.textContent).toContain("Confirmed");
    expect(c.querySelectorAll("button")).toHaveLength(0);
  });

  it("bouncing: TriangleAlert badge, the BOUNCE alert and Change address", () => {
    const onChange = vi.fn();
    mounted = mount(
      <EmailRouteRow address={ADDR} status="bouncing" onChange={onChange} />,
    );
    const c = mounted.container;
    expect(c.textContent).toContain("Bouncing");
    const badge = Array.from(c.querySelectorAll("span")).find(
      (s) => s.textContent === "Bouncing",
    );
    expect(badge?.querySelector("svg")).not.toBeNull();
    const alert = c.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(
      "Emails to orders@riverabakery.com are bouncing, so you may be missing messages. Check the address or use another one.",
    );
    expect(bounceCopy(ADDR)).toContain(ADDR);
    click(button(c, "Change address"));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("remove: an IconButton naming the address; read-only hides every action", () => {
    const onRemove = vi.fn();
    mounted = mount(
      <EmailRouteRow
        address={ADDR}
        status="waiting"
        onRemove={onRemove}
        onResend={async () => true}
      />,
    );
    click(button(mounted.container, `Remove ${ADDR}`));
    expect(onRemove).toHaveBeenCalledTimes(1);
    mounted.unmount();
    mounted = mount(
      <EmailRouteRow
        address={ADDR}
        status="bouncing"
        readOnly
        onRemove={onRemove}
        onChange={() => {}}
        onResend={async () => true}
        actions={<button type="button">Change address</button>}
      />,
    );
    expect(mounted.container.querySelectorAll("button")).toHaveLength(0);
    expect(mounted.container.textContent).toContain("are bouncing");
  });
});

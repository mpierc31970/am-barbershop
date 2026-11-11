// @vitest-environment jsdom
// Phone alerts card (11-22; DASH-34; 11-UI-SPEC "Today" § 7). iPhone outside the home screen
// gets the steps and no button; a supported browser gets Turn on alerts, which subscribes then
// saves; Not now dismisses; denied / failed show their InlineAlerts.
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
  PHONE_ALERTS_COPY,
  PhoneAlertsCard,
  canTurnOn,
  deviceFamily,
  urlBase64ToUint8Array,
  type PushEnv,
} from "./index";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const IPHONE_TAB: PushEnv = {
  family: "iphone",
  standalone: false,
  supported: false,
  permission: "unsupported",
};
const ANDROID: PushEnv = {
  family: "android",
  standalone: false,
  supported: true,
  permission: "default",
};

function render(
  env: PushEnv,
  over: Partial<Parameters<typeof PhoneAlertsCard>[0]> = {},
) {
  const onSave = vi.fn(async () => ({ ok: true }));
  const onDismiss = vi.fn();
  const subscribe = vi.fn(async () => "on" as const);
  mounted = mount(
    <ToastRegion>
      <PhoneAlertsCard
        publicKey="BPublicKey"
        onSave={onSave}
        onDismiss={onDismiss}
        readEnv={() => env}
        subscribe={subscribe}
        {...over}
      />
    </ToastRegion>,
  );
  return { onSave, onDismiss, subscribe, root: mounted.container };
}

describe("PhoneAlertsCard", () => {
  it("iPhone in a Safari tab: iPhone steps, no Turn on alerts, PUSH-UNSUPPORTED", () => {
    const { root } = render(IPHONE_TAB);
    expect(root.textContent).toContain(PHONE_ALERTS_COPY.heading);
    expect(
      root
        .querySelector("[data-phone-steps]")
        ?.getAttribute("data-phone-steps"),
    ).toBe("iphone");
    expect(root.querySelectorAll("ol li")).toHaveLength(3);
    expect(root.textContent).toContain("Tap Share, then Add to Home Screen.");
    expect(button(root, PHONE_ALERTS_COPY.turnOn)).toBeNull();
    expect(root.textContent).toContain(PHONE_ALERTS_COPY.unsupported);
  });

  it("Android: preselects Android steps and offers Turn on alerts; subscribe then save", async () => {
    const subscribe = vi.fn(
      async (_k: string, save: (s: never) => Promise<{ ok: boolean }>) => {
        await save({} as never);
        return "on" as const;
      },
    );
    const { root, onSave } = render(ANDROID, { subscribe });
    expect(
      root
        .querySelector("[data-phone-steps]")
        ?.getAttribute("data-phone-steps"),
    ).toBe("android");
    click(button(root, PHONE_ALERTS_COPY.turnOn));
    await flush();
    expect(subscribe).toHaveBeenCalledWith("BPublicKey", onSave, "android");
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(root.querySelector("[data-phone-alerts]")).toBeNull();
    expect(document.body.textContent).toContain(PHONE_ALERTS_COPY.on);
  });

  it("never prompts on load", () => {
    const { subscribe } = render(ANDROID);
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("iPhone from the home screen with push support offers the button", () => {
    const { root } = render({
      ...IPHONE_TAB,
      standalone: true,
      supported: true,
      permission: "default",
    });
    expect(button(root, PHONE_ALERTS_COPY.turnOn)).not.toBeNull();
  });

  it("Not now dismisses and hides the card", () => {
    const { root, onDismiss } = render(ANDROID);
    click(button(root, PHONE_ALERTS_COPY.notNow));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(root.querySelector("[data-phone-alerts]")).toBeNull();
  });

  it("denied shows PUSH-DENIED; a failure shows ERR-PUSH; the card stays", async () => {
    const denied = render(ANDROID, {
      subscribe: vi.fn(async () => "denied" as const),
    });
    click(button(denied.root, PHONE_ALERTS_COPY.turnOn));
    await flush();
    expect(denied.root.textContent).toContain(PHONE_ALERTS_COPY.denied);
    mounted?.unmount();
    const failed = render(ANDROID, {
      subscribe: vi.fn(async () => "error" as const),
    });
    click(button(failed.root, PHONE_ALERTS_COPY.turnOn));
    await flush();
    expect(failed.root.querySelector("[role=alert]")?.textContent).toContain(
      PHONE_ALERTS_COPY.error,
    );
    expect(failed.root.querySelector("[data-phone-alerts]")).not.toBeNull();
  });

  it("already blocked in the browser shows PUSH-DENIED up front", () => {
    const { root } = render({ ...ANDROID, permission: "denied" });
    expect(root.textContent).toContain(PHONE_ALERTS_COPY.denied);
  });

  it("switching the control shows the other steps", () => {
    const { root } = render(ANDROID);
    const iphone = root.querySelector('[role="radio"][data-value="iphone"]');
    click(iphone);
    expect(
      root
        .querySelector("[data-phone-steps]")
        ?.getAttribute("data-phone-steps"),
    ).toBe("iphone");
  });
});

describe("push-client helpers", () => {
  it("detects device families (iPadOS reports as a touch Mac)", () => {
    expect(
      deviceFamily("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)"),
    ).toBe("iphone");
    expect(
      deviceFamily("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5),
    ).toBe("iphone");
    expect(deviceFamily("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe(
      "android",
    );
    expect(deviceFamily("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(
      "desktop",
    );
  });

  it("canTurnOn needs support, and on iPhone the home screen", () => {
    expect(canTurnOn(IPHONE_TAB)).toBe(false);
    expect(canTurnOn({ ...IPHONE_TAB, supported: true })).toBe(false);
    expect(
      canTurnOn({ ...IPHONE_TAB, supported: true, standalone: true }),
    ).toBe(true);
    expect(canTurnOn(ANDROID)).toBe(true);
    expect(canTurnOn({ ...ANDROID, family: "desktop", supported: false })).toBe(
      false,
    );
  });

  it("decodes a base64url VAPID key", () => {
    expect(Array.from(urlBase64ToUint8Array("AQID_-8"))).toEqual([
      1, 2, 3, 255, 239,
    ]);
  });
});

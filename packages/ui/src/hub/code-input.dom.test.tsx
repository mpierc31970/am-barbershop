// @vitest-environment jsdom
// 06-17 Task 1: CodeInput + CodeStep (06-UI-SPEC "Submit › Step B", Typography code-input
// exception, Accessibility CodeInput bullet; D-UI-P6-12; T-06-82, T-06-83).
import { act, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodeInput, CodeStep, CODE_SENT_COPY, codeStepBody } from "./CodeInput";
import {
  button,
  click,
  mount,
  typeInto,
  type Mounted,
} from "../test-support/dom";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

function Harness({ onComplete }: { onComplete: (v: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <CodeInput
      id="code"
      name="code"
      value={value}
      onChange={setValue}
      onComplete={onComplete}
    />
  );
}

function input(): HTMLInputElement {
  return mounted!.container.querySelector("input")!;
}

describe("CodeInput", () => {
  it("is one numeric one-time-code field with the 6-digit label", () => {
    mounted = mount(<Harness onComplete={() => {}} />);
    const inputs = mounted.container.querySelectorAll("input");
    expect(inputs).toHaveLength(1);
    const el = input();
    expect(el.type).toBe("text");
    expect(el.getAttribute("inputmode")).toBe("numeric");
    expect(el.getAttribute("autocomplete")).toBe("one-time-code");
    expect(el.getAttribute("pattern")).toBe("[0-9]*");
    expect(el.maxLength).toBe(6);
    expect(el.name).toBe("code");
    const label = mounted.container.querySelector("label");
    expect(label?.textContent).toBe("6-digit code");
    expect(label?.htmlFor).toBe("code");
    expect(el.className).toContain("h-14");
    expect(el.className).toContain("tracking-[0.25em]");
  });

  it('sanitises a pasted "123 456" and completes on the sixth digit', () => {
    const onComplete = vi.fn();
    mounted = mount(<Harness onComplete={onComplete} />);
    typeInto(input(), "123 456");
    expect(input().value).toBe("123456");
    expect(onComplete).toHaveBeenCalledWith("123456");
  });

  it("ignores letters and does not complete early", () => {
    const onComplete = vi.fn();
    mounted = mount(<Harness onComplete={onComplete} />);
    typeInto(input(), "12ab3");
    expect(input().value).toBe("123");
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("describes itself by the error id", () => {
    mounted = mount(
      <CodeInput
        id="c"
        name="code"
        value=""
        onChange={() => {}}
        errorId="c-error"
      />,
    );
    expect(input().getAttribute("aria-describedby")).toBe("c-error");
    expect(input().getAttribute("aria-invalid")).toBe("true");
  });
});

function step(overrides: Partial<Parameters<typeof CodeStep>[0]> = {}) {
  const props = {
    email: "maria@example.com",
    primaryLabel: "Create my account",
    pendingLabel: "Creating your account…",
    onSubmit: vi.fn(),
    onResend: vi.fn(),
    onBack: vi.fn(),
    error: null,
    pending: false,
    ...overrides,
  };
  mounted = mount(<CodeStep {...props} />);
  return props;
}

describe("CodeStep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("says where the code went in one fixed string", () => {
    step();
    expect(codeStepBody("maria@example.com")).toBe(
      "We sent a 6-digit code to maria@example.com. It expires in 5 minutes.",
    );
    expect(mounted!.container.textContent).toContain(
      "We sent a 6-digit code to maria@example.com. It expires in 5 minutes.",
    );
    expect(mounted!.container.querySelector("h1")?.textContent).toBe(
      "Check your email",
    );
    expect(button(mounted!.container, "Create my account")).not.toBeNull();
    expect(button(mounted!.container, "Use a different email")).not.toBeNull();
  });

  it("submits from the button and from the sixth digit", () => {
    const props = step();
    typeInto(input(), "12345");
    click(button(mounted!.container, "Create my account"));
    expect(props.onSubmit).toHaveBeenLastCalledWith("12345");
    typeInto(input(), "123456");
    expect(props.onSubmit).toHaveBeenLastCalledWith("123456");
  });

  it("counts down the resend cooldown, then announces Code sent", () => {
    const props = step({ resendCooldownSec: 30 });
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    const resend = button(mounted!.container, /^Resend code/)!;
    expect(resend.textContent).toBe("Resend code (0:24)");
    expect(resend.disabled).toBe(true);
    act(() => {
      vi.advanceTimersByTime(24_000);
    });
    expect(resend.textContent).toBe("Resend code");
    expect(resend.disabled).toBe(false);
    click(resend);
    expect(props.onResend).toHaveBeenCalledTimes(1);
    const status = mounted!.container.querySelector('[role="status"]');
    expect(status?.textContent).toBe(CODE_SENT_COPY);
    expect(button(mounted!.container, /^Resend code/)!.disabled).toBe(true);
  });

  it("shows the error, ties it to the field and moves focus to it", () => {
    step({ error: "That code didn't match." });
    const alert = mounted!.container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("That code didn't match.");
    const described = input().getAttribute("aria-describedby")!;
    expect(mounted!.container.querySelector(`#${described}`)).not.toBeNull();
    expect(document.activeElement?.id).toBe(described);
  });

  it("disables the field and shows the pending label while pending", () => {
    step({ pending: true });
    expect(input().disabled).toBe(true);
    expect(mounted!.container.textContent).toContain("Creating your account…");
  });

  it("goes back with Use a different email", () => {
    const props = step();
    click(button(mounted!.container, "Use a different email"));
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });
});

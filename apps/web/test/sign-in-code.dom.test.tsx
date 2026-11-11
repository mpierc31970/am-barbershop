// @vitest-environment jsdom
// 06-17 Task 3: /sign-in "Email me a sign-in code" (06-UI-SPEC "Sign in with a code";
// D-UI-P6-3). The session actions module is mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  button,
  click,
  flush,
  mount,
  submit,
  typeInto,
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";

const action = vi.hoisted(() => ({
  signInAction: vi.fn(),
  requestMemberCodeAction: vi.fn(),
  completeMemberCodeAction: vi.fn(),
}));
vi.mock("../app/actions/session", () => action);

const { SignInForm } = await import("../app/(platform)/sign-in/SignInForm");

let mounted: Mounted | null = null;
beforeEach(() => {
  for (const fn of Object.values(action)) fn.mockReset();
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe("sign in with a code", () => {
  it("A&M fork: no code button under the password form; ?method=code still reaches it", () => {
    mounted = mount(<SignInForm />);
    const root = mounted.container;
    expect(root.querySelector('input[type="password"]')).not.toBeNull();
    expect(root.textContent).not.toContain("Email me a sign-in code");
  });

  it("?method=code opens the code form and the code carries the invite to return to (WR-E02)", async () => {
    const NEXT = `/invite/${"A".repeat(43)}`;
    action.requestMemberCodeAction.mockResolvedValue({
      step: "code",
      email: "a@b.c",
      error: null,
    });
    action.completeMemberCodeAction.mockResolvedValue({
      step: "code",
      email: "a@b.c",
      error: null,
    });
    mounted = mount(<SignInForm next={NEXT} startWithCode />);
    const root = mounted.container;
    expect(root.querySelector('input[type="password"]')).toBeNull();
    typeInto(root.querySelector('input[name="email"]'), "a@b.c");
    submit(root.querySelector("form"));
    await flush();
    typeInto(root.querySelector('input[name="code"]'), "654321");
    await flush();
    const codeFd = action.completeMemberCodeAction.mock
      .calls[0]![1] as FormData;
    expect(codeFd.get("next")).toBe(NEXT);
    // The password form carries it too.
    click(button(root, "Use a password instead"));
    expect(
      root.querySelector<HTMLInputElement>('input[name="next"]')?.value,
    ).toBe(NEXT);
  });

  it("sends the email, shows the CodeStep with Sign in, and submits the code", async () => {
    action.requestMemberCodeAction.mockResolvedValue({
      step: "code",
      email: "a@b.c",
      error: null,
    });
    action.completeMemberCodeAction.mockResolvedValue({
      step: "code",
      email: "a@b.c",
      error: "That code didn't match.",
    });
    mounted = mount(<SignInForm startWithCode />);
    const root = mounted.container;
    typeInto(root.querySelector('input[name="email"]'), "a@b.c");
    submit(root.querySelector("form"));
    await flush();
    const fd = action.requestMemberCodeAction.mock.calls[0]![1] as FormData;
    expect(fd.get("email")).toBe("a@b.c");
    expect(root.textContent).toContain(
      "We sent a 6-digit code to a@b.c. It expires in 5 minutes.",
    );
    expect(button(root, "Sign in")).not.toBeNull();
    typeInto(root.querySelector('input[name="code"]'), "654321");
    await flush();
    const codeFd = action.completeMemberCodeAction.mock
      .calls[0]![1] as FormData;
    expect(codeFd.get("code")).toBe("654321");
    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      "That code didn't match.",
    );
  });
});

// @vitest-environment jsdom
// 06-17 Task 2: the /start/submit client flow (06-UI-SPEC "Submit" Step A, Step B,
// Outcomes; D-UI-P6-9, D-UI-P6-12, D-UI-P6-14; T-06-82). The actions module is mocked.
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
  startSubmitAction: vi.fn(),
  completeSubmitAction: vi.fn(),
  resendSubmitCodeAction: vi.fn(),
}));
vi.mock("../app/actions/submit", () => action);

const { SubmitFlow } =
  await import("../app/(platform)/start/submit/SubmitFlow");

const ERR_CODE =
  "That code didn't match. Check the six digits and try again, or request a new one.";

let mounted: Mounted | null = null;
function render(pendingEmail: string | null = null) {
  mounted = mount(
    <SubmitFlow
      initialEmail="maria@example.com"
      pendingEmail={pendingEmail}
      supportEmail="help@cds.test"
    />,
  );
  return mounted.container;
}

function field(root: HTMLElement, name: string) {
  return root.querySelector(`[name="${name}"]`) as HTMLInputElement;
}

beforeEach(() => {
  action.startSubmitAction.mockReset();
  action.completeSubmitAction.mockReset();
  action.resendSubmitCodeAction.mockReset();
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe("Step A · Your details", () => {
  it("renders the heading, fields, counter, helpers and the no-terms line", () => {
    const root = render();
    expect(root.querySelector("h1")?.textContent).toBe("Almost there");
    expect(root.textContent).toContain("Nothing is charged today.");
    expect(field(root, "businessName").getAttribute("autocomplete")).toBe(
      "organization",
    );
    expect(field(root, "description").tagName).toBe("TEXTAREA");
    expect(root.textContent).toContain("0 / 200");
    expect(root.textContent).toContain(
      "One sentence, like 'Family bakery in Austin, known for sourdough.'",
    );
    expect(field(root, "email").value).toBe("maria@example.com");
    expect(root.textContent).toContain(
      "This is how you'll sign in. No password needed.",
    );
    expect(button(root, "Email me a code")).not.toBeNull();
    expect(root.textContent).toContain(
      "Next you'll set up your site's details. You'll see the agreement and pay only at checkout, after CDS has confirmed your site.",
    );
    expect(root.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it("counts the sentence as it is typed", () => {
    const root = render();
    typeInto(field(root, "description"), "Family bakery");
    expect(root.textContent).toContain("13 / 200");
  });

  it("sends the details and swaps to the code step in place", async () => {
    action.startSubmitAction.mockResolvedValue({
      step: "code",
      email: "maria@example.com",
      error: null,
    });
    const root = render();
    typeInto(field(root, "businessName"), "Rivera Bakery");
    typeInto(field(root, "description"), "Family bakery in Austin.");
    submit(root.querySelector("form"));
    await flush();
    const fd = action.startSubmitAction.mock.calls[0]![1] as FormData;
    expect(fd.get("businessName")).toBe("Rivera Bakery");
    expect(fd.get("description")).toBe("Family bakery in Austin.");
    expect(fd.get("email")).toBe("maria@example.com");
    expect(root.querySelector("h1")?.textContent).toBe("Check your email");
    expect(root.textContent).toContain(
      "We sent a 6-digit code to maria@example.com. It expires in 5 minutes.",
    );
    expect(document.activeElement?.textContent).toBe("Check your email");
  });

  it("puts a field error on its field and moves focus there", async () => {
    action.startSubmitAction.mockResolvedValue({
      step: "details",
      email: "maria@example.com",
      error: "That doesn't look like an email address. Check it and try again.",
      field: "email",
    });
    const root = render();
    submit(root.querySelector("form"));
    await flush();
    const email = field(root, "email");
    expect(email.getAttribute("aria-invalid")).toBe("true");
    const described = email.getAttribute("aria-describedby")!.split(" ");
    const text = described
      .map((id) => root.querySelector(`#${id}`)?.textContent)
      .join(" ");
    expect(text).toContain("That doesn't look like an email");
    expect(document.activeElement).toBe(email);
  });

  it("shows a form-level error in an alert that takes focus", async () => {
    action.startSubmitAction.mockResolvedValue({
      step: "details",
      email: "maria@example.com",
      error: "We couldn't send your code. Try again in a minute.",
    });
    const root = render();
    submit(root.querySelector("form"));
    await flush();
    const alert = root.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("We couldn't send your code.");
    expect(document.activeElement?.contains(alert)).toBe(true);
  });
});

describe("Step B · Check your email", () => {
  it("auto-submits the sixth digit and shows ERR-CODE with focus", async () => {
    action.completeSubmitAction.mockResolvedValue({
      step: "code",
      email: "maria@example.com",
      error: ERR_CODE,
    });
    const root = render("maria@example.com");
    typeInto(root.querySelector('input[name="code"]'), "123456");
    await flush();
    const fd = action.completeSubmitAction.mock.calls[0]![1] as FormData;
    expect(fd.get("code")).toBe("123456");
    expect([...fd.keys()]).toEqual(["code"]);
    const alert = root.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(ERR_CODE);
    expect(document.activeElement?.contains(alert)).toBe(true);
  });

  it("goes back with Use a different email, fields kept", async () => {
    action.startSubmitAction.mockResolvedValue({
      step: "code",
      email: "maria@example.com",
      error: null,
    });
    const root = render();
    typeInto(field(root, "businessName"), "Rivera Bakery");
    submit(root.querySelector("form"));
    await flush();
    click(button(root, "Use a different email"));
    expect(root.querySelector("h1")?.textContent).toBe("Almost there");
    expect(field(root, "businessName").value).toBe("Rivera Bakery");
  });

  it("resends through the action", async () => {
    vi.useFakeTimers();
    try {
      action.resendSubmitCodeAction.mockResolvedValue({ error: null });
      const root = render("maria@example.com");
      await vi.advanceTimersByTimeAsync(31_000);
      click(button(root, "Resend code"));
      await vi.advanceTimersByTimeAsync(10);
      expect(action.resendSubmitCodeAction).toHaveBeenCalledTimes(1);
      expect(root.querySelector('[role="status"]')?.textContent).toBe(
        "Code sent",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Step C · Blocked", () => {
  it("names the category, opens the lists and offers Contact CDS", async () => {
    action.completeSubmitAction.mockResolvedValue({
      step: "blocked",
      email: "maria@example.com",
      category: "Adult content",
      error: null,
    });
    const root = render("maria@example.com");
    typeInto(root.querySelector('input[name="code"]'), "123456");
    await flush();
    expect(root.querySelector("h1")?.textContent).toBe(
      "We can't host this site",
    );
    expect(root.textContent).toContain(
      "Your answers match a type of site we don't host: Adult content.",
    );
    const details = root.querySelector("details")!;
    expect(details.open).toBe(true);
    expect(details.querySelector("summary")?.textContent).toContain(
      "See what we host and why",
    );
    expect(details.querySelectorAll("li").length).toBeGreaterThan(3);
    const contact = [...root.querySelectorAll("a")].find(
      (a) => a.textContent === "Contact CDS",
    );
    expect(contact?.getAttribute("href")).toBe("mailto:help@cds.test");
    expect(root.querySelector('input[name="code"]')).toBeNull();
  });
});

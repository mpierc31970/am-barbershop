// @vitest-environment jsdom
// Staff dialogs (13-09; STAFF-06; 13-UI-SPEC "StepUpDialog", "Destructive and irreversible
// actions", "Accessibility contract"; RESEARCH Pitfall 12: a step-up never loses the action).
import { P13_COPY } from "@cds/core/staff";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  button,
  click,
  flush,
  mount,
  typeInto,
  type Mounted,
} from "../../test-support/dom";
import {
  CaseDialog,
  STAFF_DIALOG_COPY,
  StaffActionProvider,
  useStaffAction,
  type StaffActionProviderProps,
  type StaffActionResult,
} from "./index";

beforeAll(() => {
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

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

const STEP_UP: StaffActionResult<never> = {
  ok: false,
  code: "step_up_needed",
  message: "",
};

type Action = (a: string, b: number) => Promise<StaffActionResult<string>>;

function Harness({
  action,
  onResult,
}: {
  action: Action;
  onResult: (r: StaffActionResult<string>) => void;
}) {
  const run = useStaffAction(action, {
    describe: (a) => `Approve launch for ${a}`,
  });
  return (
    <button
      type="button"
      onClick={() => void run("Rivera Bakery", 7).then(onResult)}
    >
      Go
    </button>
  );
}

function setup(action: Action, over: Partial<StaffActionProviderProps> = {}) {
  const onResult = vi.fn();
  const requestStepUpCode = vi.fn(async () => ({
    ok: true as const,
    data: { otpId: "otp1", maskedEmail: "m•••@connectionsdesignstudios.com" },
  }));
  const confirmStepUp = vi.fn(
    async (input: {
      otpId: string;
      code: string;
    }): Promise<StaffActionResult<null>> => {
      void input;
      return { ok: true, data: null };
    },
  );
  const navigate = vi.fn();
  mounted = mount(
    <StaffActionProvider
      requestStepUpCode={requestStepUpCode}
      confirmStepUp={confirmStepUp}
      navigate={navigate}
      {...over}
    >
      <Harness action={action} onResult={onResult} />
    </StaffActionProvider>,
  );
  return { onResult, requestStepUpCode, confirmStepUp, navigate };
}

function stepUpDialog(): HTMLDialogElement | null {
  return document.querySelector<HTMLDialogElement>(
    "dialog[data-step-up][open]",
  );
}

describe("useStaffAction + StepUpDialog", () => {
  it("returns an ok result without a step-up", async () => {
    const action = vi.fn<Action>(async () => ({ ok: true, data: "done" }));
    const { onResult } = setup(action);
    click(button(mounted!.container, "Go"));
    await flush();
    expect(action).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith({ ok: true, data: "done" });
    expect(stepUpDialog()).toBeNull();
  });

  it("an action that throws resolves ERR_SEND instead of rejecting (WR-D06)", async () => {
    const action = vi.fn<Action>(async () => {
      throw new TypeError("Failed to fetch");
    });
    const { onResult } = setup(action);
    click(button(mounted!.container, "Go"));
    await flush();
    expect(onResult).toHaveBeenCalledWith({
      ok: false,
      code: "network",
      message: P13_COPY.ERR_SEND,
    });
  });

  it("on step_up_needed asks for a code, then re-invokes the same args exactly once", async () => {
    const action = vi
      .fn<Action>()
      .mockResolvedValueOnce(STEP_UP)
      .mockResolvedValueOnce({ ok: true, data: "live" });
    const { onResult, confirmStepUp, requestStepUpCode } = setup(action);
    click(button(mounted!.container, "Go"));
    await flush();
    const dlg = stepUpDialog()!;
    expect(dlg).not.toBeNull();
    expect(requestStepUpCode).toHaveBeenCalledTimes(1);
    expect(dlg.textContent).toContain("Confirm it's you");
    expect(dlg.textContent).toContain("Then: Approve launch for Rivera Bakery");
    expect(dlg.textContent).toContain("m•••@connectionsdesignstudios.com");
    typeInto(dlg.querySelector("input"), "123456");
    await flush();
    expect(confirmStepUp).toHaveBeenCalledWith({
      otpId: "otp1",
      code: "123456",
    });
    expect(action).toHaveBeenCalledTimes(2);
    expect(action.mock.calls[1]).toEqual(["Rivera Bakery", 7]);
    expect(onResult).toHaveBeenCalledWith({ ok: true, data: "live" });
    expect(stepUpDialog()).toBeNull();
  });

  it("a failed first code request leaves Send a new code usable (WR-E02)", async () => {
    const action = vi
      .fn<Action>()
      .mockResolvedValueOnce(STEP_UP)
      .mockResolvedValueOnce({ ok: true, data: "live" });
    const requestStepUpCode = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, code: "error", message: "" })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          otpId: "otp2",
          maskedEmail: "m•••@connectionsdesignstudios.com",
        },
      });
    const { onResult, confirmStepUp } = setup(action, {
      requestStepUpCode: requestStepUpCode as never,
    });
    click(button(mounted!.container, "Go"));
    await flush();
    const dlg = stepUpDialog()!;
    expect(dlg.textContent).toContain(STAFF_DIALOG_COPY.stepUpNoCode);
    expect(dlg.textContent).not.toContain(STAFF_DIALOG_COPY.stepUpSending);
    const resend = button(
      dlg,
      STAFF_DIALOG_COPY.stepUpResend,
    ) as HTMLButtonElement;
    expect(resend.disabled).toBe(false);
    click(resend);
    await flush();
    expect(requestStepUpCode).toHaveBeenCalledTimes(2);
    expect(dlg.textContent).toContain("m•••@connectionsdesignstudios.com");
    typeInto(dlg.querySelector("input"), "123456");
    await flush();
    expect(confirmStepUp).toHaveBeenCalledWith({
      otpId: "otp2",
      code: "123456",
    });
    expect(onResult).toHaveBeenCalledWith({ ok: true, data: "live" });
  });

  it("never loops: a second step_up_needed is returned as is", async () => {
    const action = vi.fn<Action>(async () => STEP_UP);
    const { onResult } = setup(action);
    click(button(mounted!.container, "Go"));
    await flush();
    typeInto(stepUpDialog()!.querySelector("input"), "123456");
    await flush();
    expect(action).toHaveBeenCalledTimes(2);
    expect(onResult).toHaveBeenCalledWith(STEP_UP);
  });

  it("Stop this action closes without re-invoking", async () => {
    const action = vi.fn<Action>(async () => STEP_UP);
    const { onResult, confirmStepUp } = setup(action);
    click(button(mounted!.container, "Go"));
    await flush();
    click(button(stepUpDialog()!, "Stop this action"));
    await flush();
    expect(stepUpDialog()).toBeNull();
    expect(confirmStepUp).not.toHaveBeenCalled();
    expect(action).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(STEP_UP);
  });

  it("a wrong code shows CODE-WRONG inside the dialog and keeps it open", async () => {
    const action = vi.fn<Action>(async () => STEP_UP);
    const { confirmStepUp } = setup(action);
    confirmStepUp.mockResolvedValueOnce({
      ok: false,
      code: "code_wrong",
      message: "",
    });
    click(button(mounted!.container, "Go"));
    await flush();
    const dlg = stepUpDialog()!;
    typeInto(dlg.querySelector("input"), "000000");
    await flush();
    expect(stepUpDialog()).not.toBeNull();
    expect(dlg.textContent).toContain(P13_COPY.CODE_WRONG);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("session_ended sends the browser to staff sign-in with next", async () => {
    window.history.replaceState(null, "", "/staff/sites?tab=list");
    const action = vi.fn<Action>(async () => ({
      ok: false,
      code: "session_ended",
      message: "",
    }));
    const { navigate } = setup(action);
    click(button(mounted!.container, "Go"));
    await flush();
    expect(navigate).toHaveBeenCalledWith(
      `/staff/sign-in?next=${encodeURIComponent("/staff/sites?tab=list")}`,
    );
    expect(stepUpDialog()).toBeNull();
  });
});

describe("CaseDialog", () => {
  function CaseHarness({
    destructive,
    onConfirm,
  }: {
    destructive?: boolean;
    onConfirm: (v: { reason?: string; checked?: boolean }) => void;
  }) {
    const [open, setOpen] = useState(true);
    return (
      <CaseDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Decline Rivera Bakery?"
        consequence="Full refund of $1,500. The site closes."
        caseRows={[
          ["Business", "Rivera Bakery"],
          ["Paid", "$1,500"],
        ]}
        confirmLabel="Decline and refund"
        safeLabel="Keep holding"
        destructive={destructive}
        reasonField={{ label: "Reason", min: 3, max: 500 }}
        onConfirm={onConfirm}
      />
    );
  }

  it("reads the case as a description list before the buttons", () => {
    mounted = mount(<CaseHarness onConfirm={vi.fn()} />);
    const dlg = document.querySelector("dialog[open]")!;
    const dl = dlg.querySelector("dl")!;
    expect(dl.textContent).toContain("Business");
    expect(dl.textContent).toContain("Rivera Bakery");
    const confirm = button(dlg, "Decline and refund")!;
    // dl precedes the confirm button in document order.
    expect(
      dl.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(dlg.textContent).toContain(
      "Full refund of $1,500. The site closes.",
    );
  });

  it("focuses the safe button for destructive actions", () => {
    mounted = mount(<CaseHarness destructive onConfirm={vi.fn()} />);
    const dlg = document.querySelector("dialog[open]")!;
    expect(document.activeElement).toBe(button(dlg, "Keep holding"));
  });

  it("keeps confirm disabled until the reason has 3 characters", async () => {
    const onConfirm = vi.fn();
    mounted = mount(<CaseHarness destructive onConfirm={onConfirm} />);
    const dlg = document.querySelector("dialog[open]")!;
    const confirm = button(dlg, "Decline and refund")!;
    expect(confirm.disabled).toBe(true);
    typeInto(dlg.querySelector("textarea"), "ab");
    expect(confirm.disabled).toBe(true);
    typeInto(dlg.querySelector("textarea"), "abc");
    expect(confirm.disabled).toBe(false);
    click(confirm);
    await flush();
    expect(onConfirm).toHaveBeenCalledWith({ reason: "abc" });
  });

  it("has exactly one primary action", () => {
    mounted = mount(<CaseHarness destructive onConfirm={vi.fn()} />);
    const dlg = document.querySelector("dialog[open]")!;
    expect(dlg.querySelectorAll("[data-case-primary]")).toHaveLength(1);
  });

  it("a required checkbox gates confirm", async () => {
    const onConfirm = vi.fn();
    mounted = mount(
      <CaseDialog
        open
        onClose={vi.fn()}
        title="Make Rivera Bakery live?"
        consequence="Live is final. The stage can't move back."
        caseRows={[["Open change tickets", "2"]]}
        confirmLabel="Make it live"
        safeLabel="Not yet"
        checkbox={{ label: P13_COPY.LAUNCH_ANYWAY }}
        onConfirm={onConfirm}
      />,
    );
    const dlg = document.querySelector("dialog[open]")!;
    const confirm = button(dlg, "Make it live")!;
    expect(confirm.disabled).toBe(true);
    click(dlg.querySelector('input[type="checkbox"]'));
    expect(confirm.disabled).toBe(false);
    click(confirm);
    await flush();
    expect(onConfirm).toHaveBeenCalledWith({ checked: true });
  });

  it("shows a failed result's message and stays open", async () => {
    const onConfirm = vi.fn(async () => ({
      ok: false as const,
      code: "forbidden",
      message: P13_COPY.REFUSED_ROLE,
    }));
    mounted = mount(
      <CaseDialog
        open
        onClose={vi.fn()}
        title="Move Rivera Bakery to Being built?"
        consequence="Stages only move forward."
        caseRows={[]}
        confirmLabel="Move stage"
        safeLabel="Not yet"
        onConfirm={onConfirm}
      />,
    );
    const dlg = document.querySelector("dialog[open]")!;
    click(button(dlg, "Move stage"));
    await flush();
    expect(dlg.textContent).toContain(P13_COPY.REFUSED_ROLE);
    expect(document.querySelector("dialog[open]")).not.toBeNull();
  });

  it("an onConfirm that throws shows ERR_SEND and stays open (WR-E01)", async () => {
    const onConfirm = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    mounted = mount(
      <CaseDialog
        open
        onClose={vi.fn()}
        title="Move Rivera Bakery to Being built?"
        consequence="Stages only move forward."
        caseRows={[]}
        confirmLabel="Move stage"
        safeLabel="Not yet"
        onConfirm={onConfirm}
      />,
    );
    const dlg = document.querySelector("dialog[open]")!;
    click(button(dlg, "Move stage"));
    await flush();
    expect(dlg.textContent).toContain(P13_COPY.ERR_SEND);
    expect(document.querySelector("dialog[open]")).not.toBeNull();
  });
});

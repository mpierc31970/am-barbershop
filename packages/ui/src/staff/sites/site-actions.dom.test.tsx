// @vitest-environment jsdom
// Site › Actions tab (13-43; STAFF-06, STAFF-19, STAFF-22; 13-UI-SPEC site detail "Actions",
// "Suspension", "Impersonation › Start"; T-13-43-01, T-13-43-04).
import { P13_COPY } from "@cds/core/staff";
import type { TargetGroup } from "@cds/core/support";
import { act, type ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ToastRegion } from "../../hub/Toast";
import {
  button,
  click,
  flush,
  mount,
  typeInto,
  type Mounted,
} from "../../test-support/dom";
import { StaffActionProvider } from "../dialogs";
import {
  CdsPostDialog,
  SITE_ACTIONS_COPY,
  SiteActions,
  type SiteActionsCan,
  type SiteActionsHandlers,
  type SiteActionsView,
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
});

const ORG = "aaaaaaaaaaaaaaa";
const TARGETS: TargetGroup[] = [
  {
    label: "Your site",
    options: [{ kind: "site", id: "site", label: "Whole site" }],
  },
  {
    label: "Pages",
    options: [{ kind: "page", id: "pageaaaaaaaaaa1", label: "About us" }],
  },
];

function view(over: Partial<SiteActionsView> = {}): SiteActionsView {
  return {
    orgId: ORG,
    business: "Rivera Bakery",
    timeZone: "America/Chicago",
    stage: "being_built",
    forwardStages: ["ready_for_review", "live"],
    suspension: { state: "none" },
    demo: false,
    noticeFixBy: "2026-10-19T22:00:00.000Z",
    targets: TARGETS,
    reasonPrefill: "",
    documentHref: `/staff/api/sites/${ORG}/document`,
    addonsHref: `/staff/sites/${ORG}?tab=addons`,
    ...over,
  };
}

const AGENT: SiteActionsCan = {
  ownerView: false,
  stage: false,
  suspendNow: false,
  lift: false,
};
const SUPER: SiteActionsCan = {
  ownerView: true,
  stage: true,
  suspendNow: true,
  lift: true,
};

const ok = (message = "Done.") =>
  vi.fn(async () => ({ ok: true as const, data: { message } }));

function handlers(
  over: Partial<SiteActionsHandlers> = {},
): SiteActionsHandlers {
  return {
    startImpersonation: vi.fn(async () => ({
      ok: false as const,
      code: "forbidden",
      message: "x",
    })),
    openTicket: vi.fn(async () => ({
      ok: true as const,
      data: { number: 1043, message: "Ticket #1043 opened." },
    })),
    post: ok("Posted."),
    moveStage: ok(),
    sendNotice: ok("Notice sent."),
    suspendNow: ok(),
    markFixed: ok(),
    liftSuspension: ok(),
    ...over,
  };
}

function withProviders(ui: ReactNode) {
  return (
    <ToastRegion>
      <StaffActionProvider
        requestStepUpCode={vi.fn()}
        confirmStepUp={vi.fn()}
        navigate={vi.fn()}
      >
        {ui}
      </StaffActionProvider>
    </ToastRegion>
  );
}

function dialog(): HTMLDialogElement {
  const d = [...document.querySelectorAll("dialog")].find((x) =>
    x.hasAttribute("open"),
  );
  if (!d) throw new Error("no open dialog");
  return d;
}

describe("SiteActions role gating", () => {
  it("agent: Open as owner, Suspend now and Lift suspension are disabled with Super Admin only; Send notice is enabled", async () => {
    mounted = mount(
      withProviders(
        <SiteActions view={view()} can={AGENT} actions={handlers()} />,
      ),
    );
    const c = mounted.container;
    const owner = button(c, SITE_ACTIONS_COPY.rows.openOwner.action)!;
    expect(owner.disabled).toBe(true);
    expect(owner.getAttribute("aria-describedby")).toBeTruthy();
    expect(c.textContent).toContain(P13_COPY.SUPER_ONLY);
    expect(button(c, SITE_ACTIONS_COPY.rows.openAdmin.action)!.disabled).toBe(
      false,
    );

    // Suspend or warn: the notice choice is enabled, Suspend now is not.
    click(button(c, SITE_ACTIONS_COPY.rows.notice.button));
    const d = dialog();
    const radios = [
      ...d.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ];
    expect(radios).toHaveLength(2);
    expect(radios[0]!.disabled).toBe(false);
    expect(radios[0]!.checked).toBe(true);
    expect(radios[1]!.disabled).toBe(true);
    expect(d.textContent).toContain(P13_COPY.SUPER_ONLY);
    const send = button(d, "Send notice")!;
    expect(send.disabled).toBe(true);
    typeInto(
      d.querySelector("textarea"),
      "Remove the fake discount codes on About us.",
    );
    expect(send.disabled).toBe(false);
    // The notice is previewed as the business sees it.
    expect(d.querySelector("[data-notice-preview]")?.textContent).toContain(
      "breaks the hosting rules",
    );
  });

  it("agent: a suspended site shows Lift suspension disabled; a notice site shows Suspend now… disabled and Mark fixed enabled", () => {
    mounted = mount(
      withProviders(
        <SiteActions
          view={view({
            suspension: {
              state: "suspended",
              suspendedAt: "2026-10-12T15:00:00.000Z",
              category: "illegal",
            },
          })}
          can={AGENT}
          actions={handlers()}
        />,
      ),
    );
    const lift = button(mounted.container, SITE_ACTIONS_COPY.rows.lift.action)!;
    expect(lift.disabled).toBe(true);
    expect(mounted.container.textContent).toContain("Illegal content");
    mounted.unmount();

    mounted = mount(
      withProviders(
        <SiteActions
          view={view({
            suspension: { state: "notice", fixBy: "2026-10-16T22:00:00.000Z" },
          })}
          can={AGENT}
          actions={handlers()}
        />,
      ),
    );
    expect(
      button(
        mounted.container,
        SITE_ACTIONS_COPY.rows.suspendFromNotice.button,
      )!.disabled,
    ).toBe(true);
    expect(
      button(mounted.container, SITE_ACTIONS_COPY.rows.markFixed.action)!
        .disabled,
    ).toBe(false);
  });

  it("send notice calls the action with the category and what to fix", async () => {
    const sendNotice = ok("Notice sent to Rivera Bakery. Fix by Mon 19 Oct.");
    mounted = mount(
      withProviders(
        <SiteActions
          view={view()}
          can={AGENT}
          actions={handlers({ sendNotice })}
        />,
      ),
    );
    click(button(mounted.container, SITE_ACTIONS_COPY.rows.notice.button));
    const d = dialog();
    typeInto(d.querySelector("textarea"), "Remove the fake codes.");
    click(button(d, "Send notice"));
    await flush();
    expect(sendNotice).toHaveBeenCalledWith(ORG, {
      category: "guideline",
      message: "Remove the fake codes.",
    });
  });

  it("super admin: Suspend now is destructive and needs a staff note", async () => {
    const suspendNow = ok();
    mounted = mount(
      withProviders(
        <SiteActions
          view={view()}
          can={SUPER}
          actions={handlers({ suspendNow })}
        />,
      ),
    );
    click(button(mounted.container, SITE_ACTIONS_COPY.rows.notice.button));
    const d = dialog();
    const radios = d.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    click(radios[1]!);
    const go = button(d, "Suspend now")!;
    expect(go.disabled).toBe(true);
    expect(d.querySelector("[data-consequences]")?.textContent).toContain(
      "temporarily unavailable",
    );
    const areas = d.querySelectorAll("textarea");
    typeInto(areas[0], "Phishing kit on /login");
    expect(go.disabled).toBe(false);
    click(go);
    await flush();
    expect(suspendNow).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({
        category: "illegal",
        note: "Phishing kit on /login",
      }),
    );
  });
});

describe("Open as admin", () => {
  it("a 2-character reason keeps Start viewing disabled; 3 enables it and calls the action", async () => {
    const startImpersonation = vi.fn(async () => ({
      ok: false as const,
      code: "forbidden",
      message: "Refused.",
    }));
    mounted = mount(
      withProviders(
        <SiteActions
          view={view()}
          can={AGENT}
          actions={handlers({ startImpersonation })}
        />,
      ),
    );
    click(button(mounted.container, SITE_ACTIONS_COPY.rows.openAdmin.action));
    const d = dialog();
    const start = button(d, SITE_ACTIONS_COPY.impersonation.start)!;
    const reason = d.querySelector("textarea")!;
    typeInto(reason, "ab");
    expect(start.disabled).toBe(true);
    typeInto(reason, "abc");
    expect(start.disabled).toBe(false);
    click(start);
    await flush();
    expect(startImpersonation).toHaveBeenCalledWith({
      orgId: ORG,
      view: "admin",
      reason: "abc",
    });
    expect(d.textContent).toContain("Refused.");
  });

  it("prefills the reason from ?reason=", () => {
    mounted = mount(
      withProviders(
        <SiteActions
          view={view({ reasonPrefill: "Ticket #1042" })}
          can={SUPER}
          actions={handlers()}
        />,
      ),
    );
    click(button(mounted.container, SITE_ACTIONS_COPY.rows.openOwner.action));
    const d = dialog();
    expect(d.querySelector("textarea")!.value).toBe("Ticket #1042");
    expect(button(d, SITE_ACTIONS_COPY.impersonation.start)!.disabled).toBe(
      false,
    );
    // Owner view is selected when opened from Open as owner.
    expect(
      d
        .querySelector('[role="radio"][aria-checked="true"]')
        ?.textContent?.trim(),
    ).toBe(SITE_ACTIONS_COPY.impersonation.asOwner);
  });
});

describe("CdsPostDialog", () => {
  it("shows no preview and keeps Post to site disabled until the post has text; then previews as the business sees it", () => {
    const post = ok("Posted. Bell and email (logged) for 3 people.");
    mounted = mount(
      withProviders(
        <CdsPostDialog
          open
          onClose={vi.fn()}
          orgId={ORG}
          business="Rivera Bakery"
          timeZone="America/Chicago"
          post={post}
          documentHref={`/staff/api/sites/${ORG}/document`}
        />,
      ),
    );
    const d = dialog();
    const primary = button(d, SITE_ACTIONS_COPY.post.primary)!;
    expect(primary.disabled).toBe(true);
    expect(d.querySelector("[data-post-preview]")).toBeNull();
    typeInto(d.querySelector("textarea"), "Your About page is ready.");
    const preview = d.querySelector("[data-post-preview]")!;
    expect(preview).not.toBeNull();
    expect(preview.textContent).toContain("As Rivera Bakery sees it");
    expect(preview.textContent).toContain("Your About page is ready.");
    expect(primary.disabled).toBe(false);
  });

  it("a pinned note posts kind note with the title and pinned true", async () => {
    const post = ok("Posted.");
    mounted = mount(
      withProviders(
        <CdsPostDialog
          open
          onClose={vi.fn()}
          orgId={ORG}
          business="Rivera Bakery"
          timeZone="America/Chicago"
          post={post}
          documentHref="/x"
        />,
      ),
    );
    const d = dialog();
    click(
      [...d.querySelectorAll('[role="radio"]')].find(
        (b) => b.textContent === "Note",
      ),
    );
    typeInto(d.querySelector('input[type="text"], input:not([type])'), "Hours");
    typeInto(d.querySelector("textarea"), "Closed on the 24th.");
    click(d.querySelector('input[role="switch"]'));
    expect(
      d.querySelector('[data-post-preview="note"]')?.textContent,
    ).toContain("Pinned");
    click(button(d, SITE_ACTIONS_COPY.post.primary));
    await flush();
    expect(post).toHaveBeenCalledWith({
      orgId: ORG,
      kind: "note",
      body: "Closed on the 24th.",
      title: "Hours",
      pinned: true,
    });
  });

  it("an internal message is marked Only CDS sees this and alerts nobody", () => {
    mounted = mount(
      withProviders(
        <CdsPostDialog
          open
          onClose={vi.fn()}
          orgId={ORG}
          business="Rivera Bakery"
          timeZone="America/Chicago"
          post={ok()}
          documentHref="/x"
        />,
      ),
    );
    const d = dialog();
    click(
      [...d.querySelectorAll('[role="radio"]')].find(
        (b) => b.textContent === "Internal message",
      ),
    );
    typeInto(d.querySelector("textarea"), "Owner prefers phone.");
    const p = d.querySelector('[data-post-preview="internal_message"]')!;
    expect(p.textContent).toContain(P13_COPY.INTERNAL_LINE);
    expect(p.textContent).toContain(SITE_ACTIONS_COPY.post.internalRecipients);
  });
});

describe("Stage move target", () => {
  it("follows the refreshed forward list after a move (WR-E08)", () => {
    const ui = (v: SiteActionsView) =>
      withProviders(<SiteActions view={v} can={SUPER} actions={handlers()} />);
    mounted = mount(ui(view()));
    act(() =>
      mounted!.root.render(
        ui(view({ stage: "ready_for_review", forwardStages: ["live"] })),
      ),
    );
    click(button(mounted.container, SITE_ACTIONS_COPY.rows.stage.button));
    const d = dialog();
    expect(d.textContent).toContain("Live");
    expect(d.textContent).not.toContain("to Ready for review");
  });
});

describe("CdsPostDialog document kind", () => {
  it("drops the picked file when the kind switches away from Document (WR-E07)", () => {
    mounted = mount(
      withProviders(
        <CdsPostDialog
          open
          onClose={vi.fn()}
          orgId={ORG}
          business="Rivera Bakery"
          timeZone="America/Chicago"
          post={ok()}
          documentHref="/x"
        />,
      ),
    );
    const d = dialog();
    const pickKind = (label: string) =>
      click(
        [...d.querySelectorAll('[role="radio"]')].find(
          (b) => b.textContent === label,
        ),
      );
    pickKind("Document");
    typeInto(d.querySelector('input[type="text"], input:not([type])'), "Menu");
    const input = d.querySelector<HTMLInputElement>('input[type="file"]')!;
    const f = new File(["x"], "menu.pdf", { type: "application/pdf" });
    Object.defineProperty(input, "files", { value: [f], configurable: true });
    act(() => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const primary = () => button(d, SITE_ACTIONS_COPY.post.primary)!;
    expect(primary().disabled).toBe(false);
    pickKind("Message");
    pickKind("Document");
    expect(primary().disabled).toBe(true);
  });
});

describe("Open ticket", () => {
  it("opens with the subject and message, about a page", async () => {
    const openTicket = vi.fn(async () => ({
      ok: true as const,
      data: { number: 1043, message: "Ticket #1043 opened for Rivera Bakery." },
    }));
    mounted = mount(
      withProviders(
        <SiteActions
          view={view()}
          can={AGENT}
          actions={handlers({ openTicket })}
        />,
      ),
    );
    click(button(mounted.container, SITE_ACTIONS_COPY.rows.openTicket.action));
    const d = dialog();
    const primary = button(d, SITE_ACTIONS_COPY.openTicket.primary)!;
    expect(primary.disabled).toBe(true);
    const select = d.querySelector("select")!;
    select.value = "page:pageaaaaaaaaaa1";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    typeInto(d.querySelector('input[maxlength="80"]'), "Hours look wrong");
    typeInto(d.querySelector("textarea"), "The Sunday hours are off.");
    expect(d.querySelector("[data-ticket-preview]")?.textContent).toContain(
      "Opened by CDS",
    );
    click(primary);
    await flush();
    expect(openTicket).toHaveBeenCalledWith({
      orgId: ORG,
      type: "question",
      subject: "Hours look wrong",
      body: "The Sunday hours are off.",
      target: "page:pageaaaaaaaaaa1",
    });
  });
});

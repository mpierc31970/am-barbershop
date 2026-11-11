// @vitest-environment jsdom
// Settings › People & roles components in a real DOM (11-39; DASH-22, DASH-27; D285).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  button,
  click,
  flush,
  mount,
  submit,
  typeInto,
  type Mounted,
} from "../../test-support/dom";
import { ToastRegion } from "../Toast";
import {
  PEOPLE_COPY,
  accessSummary,
  inviteExistsCopy,
  lowersAccess,
  roleChangedCopy,
  type InviteView,
  type PeopleActions,
  type PeopleLists,
  type PersonView,
} from "./copy";
import { InviteDialog } from "./InviteDialog";
import { PeopleTable, type PeopleViewer } from "./PeopleTable";

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
});

const OWNER: PersonView = {
  id: "m00000000000001",
  name: "Rosa Rivera",
  email: "rosa@example.com",
  role: "owner",
  grants: [],
  isYou: true,
};
const SAM: PersonView = {
  id: "m00000000000002",
  name: "Sam Lee",
  email: "sam@example.com",
  role: "admin",
  grants: [],
  isYou: false,
};
const JO: PersonView = {
  id: "m00000000000003",
  name: "",
  email: "jo@example.com",
  role: "viewer",
  grants: ["testimonials"],
  isYou: false,
};
const INV: InviteView = {
  id: "i00000000000001",
  email: "kim@example.com",
  role: "editor",
  grants: [],
  sentOn: "9 Oct",
  expired: false,
};
const ADDONS = [
  { slug: "testimonials", name: "Testimonials" },
  { slug: "credentials", name: "Credentials" },
];

const LISTS: PeopleLists = { people: [OWNER, SAM, JO], invites: [INV] };

function fakeActions(over: Partial<PeopleActions> = {}): PeopleActions {
  const ok = (data: PeopleLists = LISTS) =>
    Promise.resolve({ ok: true as const, data });
  return {
    invite: vi.fn(() => ok()),
    resend: vi.fn(() => ok()),
    revoke: vi.fn(() => ok({ people: LISTS.people, invites: [] })),
    changeRole: vi.fn(() => ok()),
    setGrants: vi.fn(() => ok()),
    remove: vi.fn(() => ok({ people: [OWNER, JO], invites: [INV] })),
    ...over,
  };
}

function render(viewer: PeopleViewer, actions = fakeActions(), lists = LISTS) {
  mounted = mount(
    <ToastRegion>
      <PeopleTable
        people={lists.people}
        invites={lists.invites}
        addons={ADDONS}
        orgName="Rivera Bakery"
        viewer={viewer}
        actions={actions}
      />
    </ToastRegion>,
  );
  return { c: mounted.container, actions };
}

function openMenu(c: HTMLElement, who: string) {
  click(button(c, `More actions for ${who}`));
}

describe("PeopleTable", () => {
  it("lists people then invites with role, access and status", () => {
    const { c } = render("owner");
    const rows = c.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(4);
    expect(rows[0]?.textContent).toContain("Rosa Rivera");
    expect(rows[0]?.textContent).toContain("You");
    expect(rows[0]?.textContent).toContain("Owner");
    expect(rows[2]?.textContent).toContain("Testimonials");
    expect(rows[3]?.textContent).toContain("Invited · sent 9 Oct");
    expect(c.textContent).toContain(PEOPLE_COPY.intro);
  });

  it("the Owner row never has actions; other rows do for the Owner", () => {
    const { c } = render("owner");
    expect(button(c, "More actions for Rosa Rivera")).toBeNull();
    expect(button(c, "More actions for Sam Lee")).not.toBeNull();
    expect(button(c, "More actions for kim@example.com")).not.toBeNull();
    expect(button(c, PEOPLE_COPY.invite)).not.toBeNull();
  });

  it("Admin reads only: no buttons, the owner-only note", () => {
    const { c } = render("admin");
    expect(c.querySelectorAll("tbody button")).toHaveLength(0);
    expect(button(c, PEOPLE_COPY.invite)).toBeNull();
    expect(c.textContent).toContain(PEOPLE_COPY.adminNote);
  });

  it("impersonating staff read only with the impersonation note", () => {
    const { c } = render("impersonating");
    expect(c.querySelectorAll("tbody button")).toHaveLength(0);
    expect(button(c, PEOPLE_COPY.invite)).toBeNull();
    expect(c.textContent).toContain(PEOPLE_COPY.impersonating);
  });

  it("only the Owner: the just-you line", () => {
    const { c } = render("owner", fakeActions(), {
      people: [OWNER],
      invites: [],
    });
    expect(c.textContent).toContain(PEOPLE_COPY.empty);
  });

  it("Remove confirms by name, Keep is focused, then removes", async () => {
    const { c, actions } = render("owner");
    openMenu(c, "Sam Lee");
    click(button(c, PEOPLE_COPY.remove));
    const dialog = document.querySelector("dialog[open]");
    expect(dialog?.textContent).toContain("Remove Sam from Rivera Bakery?");
    expect(
      button(dialog!, "Keep Sam")?.hasAttribute("autofocus") ||
        document.activeElement === button(dialog!, "Keep Sam"),
    ).toBe(true);
    click(button(dialog!, PEOPLE_COPY.removeConfirm));
    await flush();
    expect(actions.remove).toHaveBeenCalledWith(SAM.id);
    expect(c.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(document.body.textContent).toContain("Sam no longer has access.");
  });

  it("Cancel invite acts at once with an Undo that re-invites", async () => {
    const { c, actions } = render("owner");
    openMenu(c, "kim@example.com");
    click(button(c, PEOPLE_COPY.cancelInvite));
    await flush();
    expect(actions.revoke).toHaveBeenCalledWith(INV.id);
    expect(document.body.textContent).toContain(
      "Invite to kim@example.com cancelled.",
    );
    click(button(document.body, "Undo"));
    await flush();
    expect(actions.invite).toHaveBeenCalledWith({
      email: "kim@example.com",
      role: "editor",
      grants: [],
    });
  });

  it("lowering a role asks first; Keep puts it back", async () => {
    const { c, actions } = render("owner");
    openMenu(c, "Sam Lee");
    click(button(c, PEOPLE_COPY.changeRole));
    const drawer = document.querySelector("[data-role-drawer]")!;
    click(drawer.querySelector('input[value="viewer"]'));
    submit(drawer.querySelector("form"));
    await flush();
    expect(actions.changeRole).not.toHaveBeenCalled();
    const confirm = drawer.querySelector("[data-lower-confirm]");
    expect(confirm?.textContent).toContain("Change Sam from Admin to Viewer?");
    click(button(drawer, "Make Viewer"));
    await flush();
    expect(actions.changeRole).toHaveBeenCalledWith(SAM.id, "viewer");
    expect(document.body.textContent).toContain(
      roleChangedCopy("Sam", "viewer"),
    );
  });

  it("raising a role saves without asking; grants only for grant roles", async () => {
    const { c, actions } = render("owner");
    openMenu(c, "jo@example.com");
    click(button(c, PEOPLE_COPY.changeRole));
    const drawer = document.querySelector("[data-role-drawer]")!;
    expect(drawer.querySelector("[data-addon-access]")).not.toBeNull();
    click(drawer.querySelector('input[value="credentials"]'));
    click(drawer.querySelector('input[value="editor"]'));
    submit(drawer.querySelector("form"));
    await flush();
    expect(actions.changeRole).toHaveBeenCalledWith(JO.id, "editor");
    expect(actions.setGrants).toHaveBeenCalledWith(JO.id, [
      "testimonials",
      "credentials",
    ]);
  });

  it("a role that saves before the access save fails shows in the table and is not re-sent (WR-D03)", async () => {
    const joEditor: PersonView = { ...JO, role: "editor" };
    const afterRole: PeopleLists = {
      people: [OWNER, SAM, joEditor],
      invites: [INV],
    };
    const changeRole = vi.fn(() =>
      Promise.resolve({ ok: true as const, data: afterRole }),
    );
    const setGrants = vi
      .fn<PeopleActions["setGrants"]>()
      .mockResolvedValueOnce({
        ok: false as const,
        code: "unknown",
        message: "Add-on access did not save.",
      })
      .mockResolvedValue({
        ok: true as const,
        data: {
          people: [
            OWNER,
            SAM,
            { ...joEditor, grants: ["testimonials", "credentials"] },
          ],
          invites: [INV],
        },
      });
    const { c } = render("owner", fakeActions({ changeRole, setGrants }));
    openMenu(c, "jo@example.com");
    click(button(c, PEOPLE_COPY.changeRole));
    const drawer = document.querySelector("[data-role-drawer]")!;
    click(drawer.querySelector('input[value="credentials"]'));
    click(drawer.querySelector('input[value="editor"]'));
    submit(drawer.querySelector("form"));
    await flush();

    expect(changeRole).toHaveBeenCalledTimes(1);
    expect(drawer.textContent).toContain("Add-on access did not save.");
    // The table and a toast already show the saved role.
    const joRow = Array.from(c.querySelectorAll("tr")).find((tr) =>
      tr.textContent?.includes("jo@example.com"),
    );
    expect(joRow?.textContent).toContain("Editor");
    expect(document.body.textContent).toContain(
      roleChangedCopy("jo@example.com", "editor"),
    );

    // Save again: only the access is sent, with no lower-access question.
    submit(drawer.querySelector("form"));
    await flush();
    expect(drawer.querySelector("[data-lower-confirm]")).toBeNull();
    expect(changeRole).toHaveBeenCalledTimes(1);
    expect(setGrants).toHaveBeenCalledTimes(2);
  });

  it("a refused change shows the server's message", async () => {
    const actions = fakeActions({
      resend: vi.fn(() =>
        Promise.resolve({
          ok: false as const,
          code: "rate_limited",
          message: "Too many changes at once.",
        }),
      ),
    });
    const { c } = render("owner", actions);
    openMenu(c, "kim@example.com");
    click(button(c, PEOPLE_COPY.resend));
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain(
      "Too many changes at once.",
    );
  });
});

describe("InviteDialog", () => {
  function renderDialog(onInvite = vi.fn(fakeActions().invite)) {
    const onSent = vi.fn();
    const onClose = vi.fn();
    mounted = mount(
      <InviteDialog
        open
        onClose={onClose}
        addons={ADDONS}
        onInvite={onInvite}
        onSent={onSent}
      />,
    );
    const form = document.querySelector("[data-invite-form]")!;
    return { form, onInvite, onSent, onClose };
  }

  it("checks the email shape and requires a role before sending", async () => {
    const { form, onInvite } = renderDialog();
    typeInto(form.querySelector('input[type="email"]'), "not-an-email");
    submit(form);
    await flush();
    expect(form.textContent).toContain(PEOPLE_COPY.inviteInvalid);
    expect(onInvite).not.toHaveBeenCalled();

    typeInto(form.querySelector('input[type="email"]'), "sam@example.com");
    submit(form);
    await flush();
    expect(form.textContent).toContain("Choose a role.");
    expect(onInvite).not.toHaveBeenCalled();
  });

  it("submits email, role and grants", async () => {
    const { form, onInvite, onSent, onClose } = renderDialog();
    typeInto(form.querySelector('input[type="email"]'), " sam@example.com ");
    click(form.querySelector('input[value="editor"]'));
    click(form.querySelector('input[value="testimonials"]'));
    submit(form);
    await flush();
    expect(onInvite).toHaveBeenCalledWith({
      email: "sam@example.com",
      role: "editor",
      grants: ["testimonials"],
    });
    expect(onSent).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("Admin takes no grants: the access fieldset hides and none are sent", async () => {
    const { form, onInvite } = renderDialog();
    typeInto(form.querySelector('input[type="email"]'), "sam@example.com");
    click(form.querySelector('input[value="admin"]'));
    expect(form.querySelector("[data-addon-access]")).toBeNull();
    submit(form);
    await flush();
    expect(onInvite).toHaveBeenCalledWith({
      email: "sam@example.com",
      role: "admin",
      grants: [],
    });
  });

  it("shows INVITE-EXISTS under Email", async () => {
    const onInvite = vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        code: "invite_exists",
        message: inviteExistsCopy("sam@example.com"),
        field: "email",
      }),
    );
    const { form } = renderDialog(onInvite);
    typeInto(form.querySelector('input[type="email"]'), "sam@example.com");
    click(form.querySelector('input[value="viewer"]'));
    submit(form);
    await flush();
    expect(form.textContent).toContain(
      "sam@example.com already has access to this site.",
    );
  });
});

describe("copy helpers", () => {
  it("lowersAccess and accessSummary", () => {
    expect(lowersAccess("admin", "editor")).toBe(true);
    expect(lowersAccess("viewer", "editor")).toBe(false);
    expect(accessSummary("admin", [], ADDONS)).toBe("All add-ons");
    expect(accessSummary("viewer", [], ADDONS)).toBe("—");
    expect(accessSummary("editor", ["credentials", "gone"], ADDONS)).toBe(
      "Credentials",
    );
    expect(roleChangedCopy("Sam", "admin")).toBe("Sam is now an Admin.");
    expect(roleChangedCopy("Sam", "editor")).toBe("Sam is now an Editor.");
  });
});

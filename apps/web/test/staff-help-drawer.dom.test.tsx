// @vitest-environment jsdom
// 13-51 (deferred-items 13-50): the console "?" drawer renders a staff how-to's inline marks
// through the hub's inlineMarks: **bold** and `code` become elements, and a `[label](file.md)`
// link (staff articles have no page of their own) shows its plain label, never the raw marks.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  button,
  click,
  mount,
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";
import { StaffHelpDrawer } from "../app/(platform)/staff/(console)/StaffHelpDrawer";

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal: () => void;
    close: () => void;
  };
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  proto.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

describe("StaffHelpDrawer (13-51)", () => {
  it("renders bold, code and .md links as marks, not raw markdown", () => {
    mounted = mount(
      <StaffHelpDrawer
        name="Tickets"
        article={{
          title: "Ticket inbox",
          route: "/staff/tickets",
          activate: [],
          use: [
            {
              screen: "`/staff/tickets`",
              action: "Click **Reply**, see [Canned replies](staff-canned.md)",
              expected: "The reply shows as **Mara · CDS**",
            },
          ],
        }}
      />,
    );
    click(button(document.body, "How Tickets works"));
    const text = document.body.textContent ?? "";
    expect(text).toContain("Click Reply, see Canned replies");
    expect(text).not.toMatch(/\*\*|`|\]\(/);
    expect(document.body.querySelector("strong")?.textContent).toBe("Reply");
    expect(document.body.querySelector("code")?.textContent).toBe(
      "/staff/tickets",
    );
    expect(document.body.querySelector('a[href$=".md"]')).toBeNull();
  });
});

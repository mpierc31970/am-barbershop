// @vitest-environment jsdom
// Marketing › Social components in a real DOM (11-37; DASH-14, DASH-15, DASH-16).
import { SOCIAL_COPY, type SocialAccount } from "@cds/core/social";
import { afterEach, describe, expect, it, vi } from "vitest";
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
import { GrowChecklist, growGroups } from "./GrowChecklist";
import { SocialAccountsList, type SocialActions } from "./SocialAccountsList";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

const ORIGIN = "https://rivera.sites.example.com";

function acct(p: Partial<SocialAccount> & { id: string }): SocialAccount {
  return {
    platform: "instagram",
    name: "Instagram",
    label: "",
    url: "https://instagram.com/rivera",
    shortCode: "ig",
    order: 0,
    fallback: false,
    bioPath: "/ig",
    ...p,
  };
}

const IG = acct({ id: "a1" });
const FB_FALLBACK = acct({
  id: "a2",
  platform: "facebook",
  name: "Facebook",
  url: "https://facebook.com/rivera",
  shortCode: "fb",
  order: 1,
  fallback: true,
  bioPath: "/go/fb",
});

function fakeActions(over: Partial<SocialActions> = {}): SocialActions {
  const ok = (accounts: SocialAccount[]) =>
    Promise.resolve({ ok: true as const, data: { accounts } });
  return {
    add: vi.fn(() => ok([IG])),
    update: vi.fn(() => ok([IG])),
    remove: vi.fn(() => ok([])),
    restore: vi.fn(() => ok([IG])),
    reorder: vi.fn(() => ok([IG])),
    ...over,
  };
}

function render(
  accounts: SocialAccount[],
  opts: { canEdit?: boolean; actions?: SocialActions; preview?: boolean } = {},
) {
  const actions = opts.actions ?? fakeActions();
  mounted = mount(
    <ToastRegion>
      <SocialAccountsList
        accounts={accounts}
        origin={ORIGIN}
        preview={opts.preview ?? true}
        canEdit={opts.canEdit ?? true}
        actions={actions}
      />
    </ToastRegion>,
  );
  return { el: mounted.container, actions };
}

describe("SocialAccountsList (DASH-14, DASH-15)", () => {
  it("Copy writes the full bio link to the clipboard and says Copied", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const { el } = render([IG]);
    expect(el.textContent).toContain("Bio link: rivera.sites.example.com/ig");
    click(button(el, "Copy link for your Instagram bio"));
    await flush();
    expect(writeText).toHaveBeenCalledWith(`${ORIGIN}/ig`);
    expect(el.textContent).toContain("Copied");
    expect(el.querySelector('[role="status"]')?.textContent).toContain(
      "Instagram bio link copied.",
    );
  });

  it("a refused clipboard shows the link in a read-only field", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: () => Promise.reject(new Error("denied")) },
    });
    const { el } = render([IG]);
    click(button(el, "Copy link for your Instagram bio"));
    await flush();
    const field = el.querySelector<HTMLInputElement>("input[readonly]");
    expect(field?.value).toBe(`${ORIGIN}/ig`);
    expect(el.textContent).toContain("Copy this link.");
  });

  it("a fallback account shows BIO-FALLBACK and the /go/ link", () => {
    const { el } = render([IG, FB_FALLBACK]);
    expect(el.textContent).toContain(
      "Bio link: rivera.sites.example.com/go/fb",
    );
    expect(el.querySelector("[data-bio-fallback]")?.textContent).toBe(
      "Your page at /fb uses that address, so this account's link uses /go/fb instead.",
    );
    expect(el.querySelector("[data-bio-preview]")).not.toBeNull();
  });

  it("Add shows only presets not yet added, then Add another", () => {
    const { el } = render([IG, FB_FALLBACK]);
    const presets = [
      ...el.querySelectorAll<HTMLElement>("[data-add-account] [data-preset]"),
    ].map((b) => b.dataset.preset);
    expect(presets).toEqual([
      "tiktok",
      "youtube",
      "linkedin",
      "pinterest",
      "x",
      "threads",
      "yelp",
      "nextdoor",
      "custom",
    ]);
  });

  it("adding checks the address inline, then saves through the action with a toast", async () => {
    const { el, actions } = render([]);
    expect(el.textContent).toContain("No accounts yet. Pick one below.");
    click(button(el, "Instagram"));
    const form = el.querySelector('[data-account-form="instagram"]');
    const input = form!.querySelector<HTMLInputElement>('input[type="url"]');
    typeInto(input, "http://instagram.com/rivera");
    submit(form);
    expect(form!.textContent).toContain(SOCIAL_COPY.https);
    typeInto(input, "https://facebook.com/rivera");
    submit(form);
    expect(form!.textContent).toContain("That isn't an Instagram address");
    expect(actions.add).not.toHaveBeenCalled();
    typeInto(input, "https://instagram.com/rivera");
    submit(form);
    await flush();
    expect(actions.add).toHaveBeenCalledWith({
      platform: "instagram",
      url: "https://instagram.com/rivera",
    });
    expect(document.body.textContent).toContain(
      "Instagram added. It shows in your site's footer.",
    );
  });

  it("a server refusal (SOCIAL-DUP) shows under the field", async () => {
    const actions = fakeActions({
      add: vi.fn(() =>
        Promise.resolve({
          ok: false as const,
          code: "invalid_input",
          message: SOCIAL_COPY.dup,
        }),
      ),
    });
    const { el } = render([], { actions });
    click(button(el, "Add another"));
    const form = el.querySelector('[data-account-form="custom"]')!;
    const [name, url] = form.querySelectorAll("input");
    typeInto(name, "Etsy");
    typeInto(url, "https://etsy.com/shop/rivera");
    submit(form);
    await flush();
    expect(actions.add).toHaveBeenCalledWith({
      platform: "custom",
      label: "Etsy",
      url: "https://etsy.com/shop/rivera",
    });
    expect(form.textContent).toContain(SOCIAL_COPY.dup);
  });

  it("Remove is immediate with an Undo that restores at the same place", async () => {
    const { el, actions } = render([IG]);
    click(button(el, "More for Instagram"));
    click(button(el, "Remove"));
    await flush();
    expect(actions.remove).toHaveBeenCalledWith("a1");
    expect(document.body.textContent).toContain("Instagram removed.");
    click(button(document.body, "Undo"));
    await flush();
    expect(actions.restore).toHaveBeenCalledWith(
      { platform: "instagram", url: "https://instagram.com/rivera" },
      0,
    );
  });

  it("Move down sends the new order", async () => {
    const { el, actions } = render([IG, FB_FALLBACK]);
    click(button(el, "More for Instagram"));
    click(button(el, "Move down"));
    await flush();
    expect(actions.reorder).toHaveBeenCalledWith(["a2", "a1"]);
  });

  it("read-only members: list and copy buttons, no menu and no Add", () => {
    const { el } = render([IG], { canEdit: false });
    expect(button(el, "Copy link for your Instagram bio")).not.toBeNull();
    expect(button(el, "More for Instagram")).toBeNull();
    expect(el.querySelector("[data-add-account]")).toBeNull();
  });
});

describe("GrowChecklist (DASH-16)", () => {
  it("groups Every account first, then each added platform", () => {
    const groups = growGroups(["instagram", "custom"], "shop");
    expect(groups.map((g) => g.label)).toEqual(["Every account", "Instagram"]);
    expect(groups[1]!.tips.map((t) => t.id)).toContain("ig-products");
    expect(groups[1]!.tips.map((t) => t.id)).not.toContain("ig-portfolio");
  });

  it("ticking saves; a failed save reverts and shows ERR-SAVE", async () => {
    let fail = false;
    const onToggle = vi.fn(() =>
      fail
        ? Promise.resolve({
            ok: false as const,
            code: "save_failed",
            message: "x",
          })
        : Promise.resolve({ ok: true as const, data: { ticks: [] } }),
    );
    mounted = mount(
      <GrowChecklist
        platforms={["instagram"]}
        category="shop"
        ticks={["all-same-name"]}
        canEdit
        onToggle={onToggle}
      />,
    );
    const el = mounted.container;
    const total = el.querySelectorAll('input[type="checkbox"]').length;
    expect(el.querySelector("[data-grow-done]")?.textContent).toBe(
      `1 of ${total} done`,
    );
    const box = el.querySelector<HTMLInputElement>('[data-tip="ig-bio-link"]')!;
    click(box);
    await flush();
    expect(onToggle).toHaveBeenCalledWith("ig-bio-link", true);
    expect(box.checked).toBe(true);
    expect(el.textContent).toContain("Saved");
    fail = true;
    click(box);
    await flush();
    expect(box.checked).toBe(true);
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      "That didn't save.",
    );
  });

  it("no accounts: Every account only, with the hint; read-only is disabled", () => {
    mounted = mount(
      <GrowChecklist
        platforms={[]}
        category="other"
        ticks={[]}
        canEdit={false}
        onToggle={vi.fn()}
      />,
    );
    const el = mounted.container;
    expect(
      [...el.querySelectorAll<HTMLElement>("[data-grow-group]")].map(
        (g) => g.dataset.growGroup,
      ),
    ).toEqual(["all"]);
    expect(el.textContent).toContain(
      "Add an account above to see tips for it.",
    );
    expect(
      el.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled,
    ).toBe(true);
  });
});

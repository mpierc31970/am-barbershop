// @vitest-environment jsdom
// P10 purchase side (10-13; 10-UI-SPEC sections 4-5, `ChargeConfirmDialog`, destructive
// actions, a11y): ChargeConfirmDialog, CarePlanPanel, MediaPacksPanel.
import { act, useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  button,
  click,
  flush,
  mount,
  type Mounted,
} from "../../test-support/dom";
import { ToastRegion } from "../Toast";
import { ChargeConfirmDialog } from "./ChargeConfirmDialog";
import { CarePlanPanel, MediaPacksPanel } from "./index";
import type {
  CarePlanView,
  ChargePreview,
  ChargeResult,
  MediaPacksView,
} from "./types";

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
  vi.restoreAllMocks();
});

const preview: ChargePreview = {
  title: "Add the Care Plan?",
  what: "1 hour a month of changes made for you by Support.",
  todayCents: 4150,
  todayLabel: "For the rest of October",
  thenText: "$99/mo on your monthly bill from 1 Nov",
  cardLine: "Plus sales tax. Charged to Visa ending 4242.",
  confirmLabel: "Add and pay $41.50",
  token: "tok-1",
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function body(): string {
  return document.body.textContent ?? "";
}

function cancel(dialog: Element | null) {
  if (!dialog) throw new Error("no dialog");
  act(() => {
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
  });
}

describe("ChargeConfirmDialog", () => {
  function Harness({
    onConfirm,
    p = preview,
    onClose = () => {},
  }: {
    onConfirm: (token: string) => Promise<ChargeResult>;
    p?: ChargePreview | null;
    onClose?: () => void;
  }) {
    const [open, setOpen] = useState(true);
    return (
      <ToastRegion>
        <ChargeConfirmDialog
          open={open}
          preview={p}
          onConfirm={onConfirm}
          onClose={() => {
            onClose();
            setOpen(false);
          }}
          updateCardHref="/hub/settings/billing/card"
        />
      </ToastRegion>
    );
  }

  it("shows title, what, today, then, card line and the two buttons", () => {
    mounted = mount(<Harness onConfirm={vi.fn()} />);
    const t = body();
    expect(t).toContain("Add the Care Plan?");
    expect(t).toContain("1 hour a month of changes made for you by Support.");
    expect(t).toContain("Today · $41.50");
    expect(t).toContain("For the rest of October");
    expect(t).toContain("Then · $99/mo on your monthly bill from 1 Nov");
    expect(t).toContain("Plus sales tax. Charged to Visa ending 4242.");
    const primary = button(document.body, "Add and pay $41.50");
    expect(primary).not.toBeNull();
    expect(primary?.autofocus || document.activeElement === primary).toBe(true);
    expect(button(document.body, "Not now")).not.toBeNull();
    expect(document.body.innerHTML).toContain("tabular-nums");
  });

  it("null preview: skeleton and a disabled primary", () => {
    mounted = mount(<Harness onConfirm={vi.fn()} p={null} />);
    expect(document.querySelector("[data-charge-skeleton]")).not.toBeNull();
    const primaries = Array.from(document.querySelectorAll("button")).filter(
      (b) => b.getAttribute("data-charge-primary") !== null,
    );
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.disabled).toBe(true);
  });

  it("pending: Charging your card…, not dismissible; ok closes and toasts", async () => {
    const d = deferred<ChargeResult>();
    const onClose = vi.fn();
    mounted = mount(<Harness onConfirm={() => d.promise} onClose={onClose} />);
    click(button(document.body, "Add and pay $41.50"));
    expect(body()).toContain("Charging your card…");
    cancel(document.querySelector("dialog"));
    click(button(document.body, "Not now"));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      d.resolve({ ok: true, toast: "Care Plan added. Receipt emailed." });
    });
    await flush();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(body()).toContain("Care Plan added. Receipt emailed.");
  });

  it("declined: ERR-CARD with Update card, focus on the alert, stays open", async () => {
    const onClose = vi.fn();
    mounted = mount(
      <Harness
        onConfirm={async () => ({
          ok: false,
          reason: "card_declined",
          message: "declined",
        })}
        onClose={onClose}
      />,
    );
    click(button(document.body, "Add and pay $41.50"));
    await flush();
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(
      "Your card was declined. Update it in Settings › Billing.",
    );
    expect(alert?.textContent).toContain("Nothing was added.");
    const link = Array.from(document.querySelectorAll("a")).find(
      (a) => a.textContent === "Update card",
    );
    expect(link?.getAttribute("href")).toBe("/hub/settings/billing/card");
    expect(alert?.contains(document.activeElement)).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector("dialog")?.hasAttribute("open")).toBe(true);
  });

  it("CR-C01: confirms with the preview's token; a moved price shows the new figure and confirms with its token", async () => {
    const onConfirm = vi
      .fn<(token: string) => Promise<ChargeResult>>()
      .mockResolvedValueOnce({
        ok: false,
        reason: "price_changed",
        message:
          "The price changed since you opened this. Check the new figure, then confirm again.",
        preview: {
          ...preview,
          todayCents: 4400,
          confirmLabel: "Add and pay $44.00",
          token: "tok-2",
        },
      })
      .mockResolvedValueOnce({ ok: true, toast: "Care Plan added." });
    mounted = mount(<Harness onConfirm={onConfirm} />);
    click(button(document.body, "Add and pay $41.50"));
    await flush();
    expect(onConfirm).toHaveBeenLastCalledWith("tok-1");
    expect(body()).toContain("The price changed since you opened this.");
    expect(body()).toContain("Today · $44.00");
    expect(body()).not.toContain("Today · $41.50");
    click(button(document.body, "Add and pay $44.00"));
    await flush();
    expect(onConfirm).toHaveBeenLastCalledWith("tok-2");
    expect(body()).toContain("Care Plan added.");
  });

  it("other errors show the server message", async () => {
    mounted = mount(
      <Harness
        onConfirm={async () => ({
          ok: false,
          reason: "error",
          message:
            "We couldn't charge your card just now. Try again in a minute.",
        })}
      />,
    );
    click(button(document.body, "Add and pay $41.50"));
    await flush();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "We couldn't charge your card just now.",
    );
  });
});

const carePreview: ChargePreview = {
  ...preview,
  confirmLabel: "Add Care Plan, $99/mo",
};

const careOn = (over: Partial<CarePlanView> = {}): CarePlanView => ({
  on: true,
  usedMinutes: 25,
  monthLabel: "October",
  resetLabel:
    "Resets on 1 Nov. Need more than the hour? Ask Support; extra time is quoted before any work starts.",
  entries: [
    { date: "8 Oct", minutes: 15, note: "Swapped the hero photo" },
    { date: "3 Oct", minutes: 10, note: "New opening hours" },
  ],
  totalEntries: 2,
  addLabel: "Add the Care Plan, $99/mo",
  ...over,
});

function carePanel(
  view: CarePlanView,
  over: Partial<Parameters<typeof CarePlanPanel>[0]> = {},
) {
  return (
    <ToastRegion>
      <CarePlanPanel
        view={view}
        canBuy
        loadAddPreview={async () => carePreview}
        onAdd={async () => ({
          ok: true,
          toast: "Care Plan added. Receipt emailed.",
        })}
        onRemove={async () => ({ ok: true, toast: "Care Plan removed." })}
        updateCardHref="/hub/settings/billing/card"
        {...over}
      />
    </ToastRegion>
  );
}

describe("CarePlanPanel", () => {
  it("off + canBuy: CARE-OFF and Add opens the charge dialog with the preview", async () => {
    const load = vi.fn(async () => carePreview);
    mounted = mount(
      carePanel(careOn({ on: false, usedMinutes: 0 }), {
        loadAddPreview: load,
      }),
    );
    expect(body()).toContain(
      "1 hour a month of changes made for you by Support, on top of the support every plan includes. Unused time doesn't carry over.",
    );
    click(button(document.body, "Add the Care Plan, $99/mo"));
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(button(document.body, "Add Care Plan, $99/mo")).not.toBeNull();
    expect(body()).toContain("Add the Care Plan?");
  });

  it("off + !canBuy: no add button", () => {
    mounted = mount(carePanel(careOn({ on: false }), { canBuy: false }));
    expect(button(document.body, "Add the Care Plan, $99/mo")).toBeNull();
  });

  it("WR-C05: the add label is the server's catalog price; unset means no add button", () => {
    mounted = mount(
      carePanel(careOn({ on: false, addLabel: "Add the Care Plan, $119/mo" })),
    );
    expect(button(document.body, "Add the Care Plan, $119/mo")).not.toBeNull();
    expect(body()).not.toContain("$99");
    mounted.unmount();
    mounted = mount(carePanel(careOn({ on: false, addLabel: null })));
    expect(
      Array.from(document.querySelectorAll("button")).some((b) =>
        (b.textContent ?? "").startsWith("Add the Care Plan"),
      ),
    ).toBe(false);
  });

  it("on: meter, reset line and entries", () => {
    mounted = mount(carePanel(careOn()));
    const meter = document.querySelector('[role="meter"]');
    expect(meter?.getAttribute("aria-label")).toBe("Care Plan minutes used");
    expect(body()).toContain("25 of 60 minutes used in October");
    expect(body()).toContain("Resets on 1 Nov.");
    expect(body()).toContain("Swapped the hero photo");
    expect(document.querySelector("[data-usage-fill]")?.className).toContain(
      "bg-hub-ink",
    );
  });

  it("warning at 48 minutes, danger at 60", () => {
    mounted = mount(carePanel(careOn({ usedMinutes: 48 })));
    expect(document.querySelector("[data-usage-fill]")?.className).toContain(
      "bg-hub-warning",
    );
    mounted.unmount();
    mounted = mount(carePanel(careOn({ usedMinutes: 60 })));
    expect(document.querySelector("[data-usage-fill]")?.className).toContain(
      "bg-hub-danger",
    );
  });

  it("at most 5 entries, then Show all {n}", () => {
    const entries = Array.from({ length: 7 }, (_, i) => ({
      date: `${i + 1} Oct`,
      minutes: 5,
      note: `Entry ${i + 1}`,
    }));
    mounted = mount(carePanel(careOn({ entries, totalEntries: 7 })));
    expect(document.querySelectorAll("[data-care-entry]")).toHaveLength(5);
    click(button(document.body, "Show all 7"));
    expect(document.querySelectorAll("[data-care-entry]")).toHaveLength(7);
  });

  it("empty month", () => {
    mounted = mount(
      carePanel(careOn({ entries: [], totalEntries: 0, usedMinutes: 0 })),
    );
    expect(body()).toContain("No time used yet this month.");
  });

  it("Remove opens a danger confirm with Keep Care Plan focused", async () => {
    const onRemove = vi.fn(async (): Promise<ChargeResult> => ({
      ok: true,
      toast: "Care Plan removed.",
    }));
    mounted = mount(carePanel(careOn(), { onRemove }));
    click(button(document.body, "Remove the Care Plan"));
    expect(body()).toContain("Remove the Care Plan?");
    expect(body()).toContain(
      "Support stops making changes for you today, and your next bill is credited for the rest of the month.",
    );
    expect(document.activeElement).toBe(
      button(document.body, "Keep Care Plan"),
    );
    click(button(document.body, "Remove Care Plan"));
    await flush();
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(body()).toContain("Care Plan removed.");
  });
});

const packs = (over: Partial<MediaPacksView> = {}): MediaPacksView => ({
  usedLabel: "1.2 GB",
  allowanceLabel: "7 GB",
  ratio: 1.2 / 7,
  packs5: 1,
  packs25: 0,
  removeRefusal: {},
  prices: {
    "5gb": { add: "$5/mo", current: "$5/mo", drop: "$5" },
    "25gb": { add: "$15/mo", current: "$15/mo", drop: "$15" },
  },
  ...over,
});

function packsPanel(
  view: MediaPacksView,
  over: Partial<Parameters<typeof MediaPacksPanel>[0]> = {},
) {
  return (
    <ToastRegion>
      <MediaPacksPanel
        view={view}
        canBuy
        loadPreview={async (size) => ({
          ...preview,
          confirmLabel: size === "5gb" ? "Add 5 GB" : "Add 25 GB",
        })}
        onAdd={async () => ({
          ok: true,
          toast: "5 GB added. Receipt emailed.",
        })}
        onRemove={async () => ({ ok: true, toast: "5 GB pack removed." })}
        updateCardHref="/hub/settings/billing/card"
        {...over}
      />
    </ToastRegion>
  );
}

describe("MediaPacksPanel", () => {
  it("meter, included row, pack rows and add buttons", () => {
    mounted = mount(packsPanel(packs()));
    const t = body();
    expect(t).toContain("1.2 GB of 7 GB used");
    expect(t).toContain("Included · 2 GB");
    expect(t).toContain("+5 GB pack × 1 · $5/mo");
    expect(t).toContain("+25 GB pack × 0");
    expect(button(document.body, "Add 5 GB, $5/mo")).not.toBeNull();
    expect(button(document.body, "Add 25 GB, $15/mo")).not.toBeNull();
    expect(
      document.querySelector('[role="meter"]')?.getAttribute("aria-label"),
    ).toBe("Media storage used");
  });

  it("Add 25 GB loads that size's preview into the charge dialog", async () => {
    const loadPreview = vi.fn(async (size: "5gb" | "25gb") => ({
      ...preview,
      confirmLabel: size === "5gb" ? "Add 5 GB" : "Add 25 GB",
    }));
    const onAdd = vi.fn(async (): Promise<ChargeResult> => ({
      ok: true,
      toast: "25 GB added. Receipt emailed.",
    }));
    mounted = mount(packsPanel(packs(), { loadPreview, onAdd }));
    click(button(document.body, "Add 25 GB, $15/mo"));
    await flush();
    expect(loadPreview).toHaveBeenCalledWith("25gb");
    click(button(document.body, "Add 25 GB"));
    await flush();
    expect(onAdd).toHaveBeenCalledWith("25gb", "tok-1");
    expect(body()).toContain("25 GB added. Receipt emailed.");
  });

  it("refusal: Remove one shows the warning in place and opens no dialog", () => {
    const refusal =
      "You're using 6.2 GB, more than the 2 GB you'd have left. Delete 4.2 GB of media first, then remove the pack.";
    mounted = mount(packsPanel(packs({ removeRefusal: { "5gb": refusal } })));
    click(button(document.body, "Remove one"));
    expect(body()).toContain(refusal);
    expect(document.querySelector("dialog[open]")).toBeNull();
  });

  it("WR-C06: the refusal is per size; the other size opens the danger confirm", () => {
    const refusal =
      "You're using 20 GB, more than the 7 GB you'd have left. Delete 13 GB of media first, then remove the pack.";
    mounted = mount(
      packsPanel(
        packs({ packs5: 1, packs25: 1, removeRefusal: { "25gb": refusal } }),
      ),
    );
    const [remove5, remove25] = Array.from(
      document.querySelectorAll("button"),
    ).filter((b) => b.textContent === "Remove one");
    click(remove25);
    expect(body()).toContain(refusal);
    expect(document.querySelector("dialog[open]")).toBeNull();
    click(remove5);
    expect(body()).toContain("Remove a 5 GB pack?");
  });

  it("Remove one: danger confirm with Keep pack focused", async () => {
    const onRemove = vi.fn(async (): Promise<ChargeResult> => ({
      ok: true,
      toast: "5 GB pack removed.",
    }));
    mounted = mount(packsPanel(packs(), { onRemove }));
    click(button(document.body, "Remove one"));
    expect(body()).toContain("Remove a 5 GB pack?");
    expect(document.activeElement).toBe(button(document.body, "Keep pack"));
    click(button(document.body, "Remove pack"));
    await flush();
    expect(onRemove).toHaveBeenCalledWith("5gb");
  });

  it("WR-C05: every money label is the server's; an unset size is not offered", async () => {
    mounted = mount(
      packsPanel(
        packs({
          prices: {
            // The add price moved to $7; this owner's pack is still billed at $5 (lock).
            "5gb": { add: "$7/mo", current: "$5/mo", drop: "$5" },
            "25gb": { add: null, current: null, drop: null },
          },
        }),
      ),
    );
    expect(body()).toContain("+5 GB pack × 1 · $5/mo");
    expect(button(document.body, "Add 5 GB, $7/mo")).not.toBeNull();
    expect(
      Array.from(document.querySelectorAll("button")).some((b) =>
        (b.textContent ?? "").startsWith("Add 25 GB"),
      ),
    ).toBe(false);
    click(button(document.body, "Remove one"));
    expect(body()).toContain(
      "Your storage drops by 5 GB and your bill drops by $5 a month, credited for the rest of this month.",
    );
  });

  it("!canBuy: no add or remove buttons", () => {
    mounted = mount(packsPanel(packs(), { canBuy: false }));
    expect(button(document.body, "Add 5 GB, $5/mo")).toBeNull();
    expect(button(document.body, "Remove one")).toBeNull();
  });
});

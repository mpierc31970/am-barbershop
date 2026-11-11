// 11-12: CDS platform announcements for From CDS on Today (DASH-23; T-11-12-03). One active
// announcement at a time: inside its dates, matching the org's path (or every path). Only
// super_admin may set or clear one (announce_set), every change is audited, and the link is
// https or a /hub/ path.
import { Forbidden, InvalidInput } from "@cds/core";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import type { PlatformContext } from "../src/context";
import {
  activeAnnouncement,
  clearAnnouncement,
  setAnnouncement,
  staffCurrentAnnouncement,
} from "../src/today/announcements";
import { bootPb, type PbInstance } from "./pb-harness";
import { staffContext } from "./seeded";

let inst: PbInstance | null = null;
let pb: PocketBase;
let superCtx: PlatformContext;
let agentCtx: PlatformContext;

const NOW = new Date("2026-10-15T17:00:00Z");
const clock = (d: Date) => ({ now: () => d });
const plus = (d: Date, hours: number) =>
  new Date(d.getTime() + hours * 3_600_000);

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  superCtx = await staffContext(inst, "announce-super@cds.test", "super_admin");
  agentCtx = await staffContext(
    inst,
    "announce-agent@cds.test",
    "support_agent",
  );
});

beforeEach(async () => {
  if (!inst) return;
  for (const r of await pb.collection("platform_announcements").getFullList()) {
    await pb.collection("platform_announcements").delete(r.id);
  }
});

afterAll(async () => {
  await inst?.stop();
});

describe("platform announcements (DASH-23)", () => {
  it("a studio-only announcement is not shown to a standard org", async (t) => {
    if (!inst) return t.skip();
    const { id } = await setAnnouncement(
      superCtx,
      {
        title: "Studio Booking now sends reminders",
        body: "Turn them on in Booking settings.",
        href: "/hub/addons/studio-booking",
        paths: ["studio"],
      },
      clock(NOW),
    );
    expect(await activeAnnouncement(NOW, "standard")).toBeNull();
    expect(await activeAnnouncement(NOW, "studio")).toEqual({
      id,
      title: "Studio Booking now sends reminders",
      body: "Turn them on in Booking settings.",
      href: "/hub/addons/studio-booking",
    });
  });

  it("an announcement for every path is shown to both; not before it starts", async (t) => {
    if (!inst) return t.skip();
    const start = plus(NOW, 2);
    const { id } = await setAnnouncement(
      superCtx,
      { title: "Planned maintenance Sunday", startsAt: start },
      clock(NOW),
    );
    expect(await activeAnnouncement(NOW, "standard")).toBeNull();
    const later = plus(NOW, 3);
    expect((await activeAnnouncement(later, "standard"))?.id).toBe(id);
    expect((await activeAnnouncement(later, "studio"))?.id).toBe(id);
    expect((await activeAnnouncement(later, "studio"))?.href).toBe("");
  });

  it("an ended announcement is not returned", async (t) => {
    if (!inst) return t.skip();
    await setAnnouncement(
      superCtx,
      {
        title: "Short notice",
        startsAt: plus(NOW, -5),
        endsAt: plus(NOW, -1),
      },
      clock(plus(NOW, -6)),
    );
    expect(await activeAnnouncement(NOW, "standard")).toBeNull();
    expect((await activeAnnouncement(plus(NOW, -2), "standard"))?.title).toBe(
      "Short notice",
    );
  });

  it("setting a new one ends the previous; clear ends the current", async (t) => {
    if (!inst) return t.skip();
    const first = await setAnnouncement(
      superCtx,
      { title: "First", href: "https://connectionsdesignstudios.com/news" },
      clock(plus(NOW, -1)),
    );
    const second = await setAnnouncement(
      superCtx,
      { title: "Second" },
      clock(NOW),
    );
    expect(second.ended).toEqual([first.id]);
    const row = await pb.collection("platform_announcements").getOne(first.id);
    expect(new Date(row.ends_at).getTime()).toBe(NOW.getTime());
    expect((await activeAnnouncement(NOW, "standard"))?.id).toBe(second.id);
    expect((await activeAnnouncement(plus(NOW, -0.5), "standard"))?.id).toBe(
      first.id,
    );

    const audits = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "action = 'platform.announcement_set' && target_id = {:id}",
        {
          id: second.id,
        },
      ),
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actor).toBe(superCtx.actor);

    const cleared = await clearAnnouncement(superCtx, clock(plus(NOW, 1)));
    expect(cleared.ended).toEqual([second.id]);
    expect(await activeAnnouncement(plus(NOW, 2), "standard")).toBeNull();
  });

  it("13-37: staffCurrentAnnouncement shows the active one on any path to both staff roles", async (t) => {
    if (!inst) return t.skip();
    expect(await staffCurrentAnnouncement(agentCtx, clock(NOW))).toBeNull();
    const ends = plus(NOW, 24 * 14);
    const { id } = await setAnnouncement(
      superCtx,
      {
        title: "Studio only",
        body: "Body",
        href: "/hub/billing",
        paths: ["studio"],
        startsAt: NOW,
        endsAt: ends,
      },
      clock(NOW),
    );
    const view = await staffCurrentAnnouncement(agentCtx, clock(plus(NOW, 1)));
    expect(view).toMatchObject({
      id,
      title: "Studio only",
      body: "Body",
      href: "/hub/billing",
      paths: ["studio"],
    });
    expect(Date.parse(view!.endsAt!.replace(" ", "T"))).toBe(ends.getTime());
    await clearAnnouncement(superCtx, clock(plus(NOW, 2)));
    expect(
      await staffCurrentAnnouncement(superCtx, clock(plus(NOW, 3))),
    ).toBeNull();
  });

  it("refuses a support_agent and unsafe links", async (t) => {
    if (!inst) return t.skip();
    await expect(
      setAnnouncement(agentCtx, { title: "Nope" }, clock(NOW)),
    ).rejects.toThrow(Forbidden);
    await expect(clearAnnouncement(agentCtx, clock(NOW))).rejects.toThrow(
      Forbidden,
    );
    for (const href of [
      "javascript:x",
      "http://example.com",
      "//evil.example",
      "/admin",
      "https://user:pw@example.com",
      "data:text/html,hi",
    ]) {
      await expect(
        setAnnouncement(superCtx, { title: "Link", href }, clock(NOW)),
      ).rejects.toThrow(InvalidInput);
    }
    await expect(
      setAnnouncement(superCtx, { title: "" }, clock(NOW)),
    ).rejects.toThrow(InvalidInput);
    await expect(
      setAnnouncement(
        superCtx,
        { title: "Bad path", paths: ["enterprise" as never] },
        clock(NOW),
      ),
    ).rejects.toThrow(InvalidInput);
    await expect(
      setAnnouncement(
        superCtx,
        { title: "Backwards", startsAt: NOW, endsAt: plus(NOW, -1) },
        clock(NOW),
      ),
    ).rejects.toThrow(InvalidInput);
    expect(await pb.collection("platform_announcements").getFullList()).toEqual(
      [],
    );
  });
});

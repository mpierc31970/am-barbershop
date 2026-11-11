// orgIdentity reads the own sending domain (P14, 14-25 choice 6; ONB-10, RESEARCH Pitfall 2,
// T-14-25-01). The superuser client is mocked: one org, one profile row, one confirmed route.
import { senderFor } from "@cds/core/email";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown> | null;
const state: { profile: Row; route: Row; profileFields: string } = {
  profile: null,
  route: { address: "maria@gmail.com" },
  profileFields: "",
};

vi.mock("../client", () => ({
  withSuperuser: async (fn: (pb: unknown) => Promise<unknown>) =>
    fn({
      filter: (q: string) => q,
      collection: (name: string) => ({
        getOne: async () => ({
          id: "org000000000001",
          name: "Rivera Bakery",
          slug: "rivera-bakery",
        }),
        getFirstListItem: async (_f: string, opts: { fields: string }) => {
          if (name === "business_profile") {
            state.profileFields = opts.fields;
            if (!state.profile) throw new Error("404");
            return state.profile;
          }
          if (!state.route) throw new Error("404");
          return state.route;
        },
      }),
    }),
}));

const { orgIdentity } = await import("./send");

const env = {
  mailDomain: "send.connectionsdesignstudios.com",
  supportEmail: null,
};

beforeEach(() => {
  state.profile = null;
  state.route = { address: "maria@gmail.com" };
});

describe("orgIdentity (ONB-10, 14-25)", () => {
  it("reads sending_domain, sending_local_part and sending_domain_verified", async () => {
    state.profile = {
      sending_domain: "riverabakery.example",
      sending_local_part: "bookings",
      sending_domain_verified: true,
    };
    const id = await orgIdentity("org000000000001");
    expect(state.profileFields).toContain("sending_local_part");
    expect(id).toMatchObject({
      kind: "org",
      ownDomain: "riverabakery.example",
      localPart: "bookings",
      sendingDomainVerified: true,
      replyTo: "maria@gmail.com",
    });
    expect(senderFor(id, env).fromAddress).toBe(
      "bookings@riverabakery.example",
    );
  });

  it("an unverified domain keeps the platform From", async () => {
    state.profile = {
      sending_domain: "riverabakery.example",
      sending_local_part: "bookings",
      sending_domain_verified: false,
    };
    const id = await orgIdentity("org000000000001");
    expect(senderFor(id, env).fromAddress).toBe(
      "rivera-bakery@send.connectionsdesignstudios.com",
    );
  });

  it("no profile row: no own domain", async () => {
    const id = await orgIdentity("org000000000001");
    expect(id).toMatchObject({ ownDomain: null, sendingDomainVerified: false });
  });

  it("verified with no local part sends as hello@", async () => {
    state.profile = {
      sending_domain: "riverabakery.example",
      sending_local_part: "",
      sending_domain_verified: true,
    };
    const id = await orgIdentity("org000000000001");
    expect(senderFor(id, env).fromAddress).toBe("hello@riverabakery.example");
  });
});

// 14-35 seed and readers for the apps review-mode integration test (DOM-10, D172, P14-P26). Like
// forms-seed.ts, the superuser client stays inside packages/db (Invariant 1): apps tests get
// plain fields back. One org at stage ready_for_review with a preview host (primary) and a
// verified custom host, an Owner, two published pages (Home, About us) and a draft page.
import { randomBytes } from "node:crypto";
import { superuser } from "../src/client";
import { mintOrgContext, type OrgContext } from "../src/context";

export type ReviewSeed = {
  org: string;
  owner: string;
  preview: string;
  custom: string;
  pages: { id: string; title: string; path: string }[];
  ctx: OrgContext;
};

let n = 0;

export async function seedReviewSite(): Promise<ReviewSeed> {
  const pb = await superuser();
  n += 1;
  const t = randomBytes(4).toString("hex");
  const org = (
    await pb.collection("organizations").create({
      name: `Review mode ${n}`,
      slug: `review-mode-${n}-${t}`,
      status: "active",
      stage: "ready_for_review",
    })
  ).id;
  const preview = `review-mode-${n}-${t}.sites.localhost`;
  const custom = `review-mode-${n}-${t}.example.com`;
  await pb.collection("org_hosts").create({
    hostname: preview,
    organization: org,
    kind: "preview",
    primary: true,
  });
  await pb.collection("org_hosts").create({
    hostname: custom,
    organization: org,
    kind: "custom",
    primary: false,
    verified_at: "2026-10-01 10:00:00.000Z",
  });
  const password = randomBytes(18).toString("hex");
  const owner = (
    await pb.collection("users").create({
      email: `owner-review-${n}-${t}@cds.test`,
      password,
      passwordConfirm: password,
      name: `Owner ${n}`,
    })
  ).id;
  await pb
    .collection("memberships")
    .create({ user: owner, organization: org, role: "owner" });
  const pages: ReviewSeed["pages"] = [];
  for (const [slug, title] of [
    ["home", "Home"],
    ["about", "About us"],
  ] as const) {
    const id = (
      await pb.collection("pages").create({
        organization: org,
        slug,
        title,
        status: "published",
        kind: "builder",
        published_at: "2026-10-01 10:00:00.000Z",
      })
    ).id;
    pages.push({ id, title, path: slug === "home" ? "/" : `/${slug}` });
  }
  await pb.collection("pages").create({
    organization: org,
    slug: "draft",
    title: "Draft",
    status: "draft",
    kind: "builder",
  });
  return {
    org,
    owner,
    preview,
    custom,
    pages,
    ctx: mintOrgContext({
      orgId: org,
      actor: owner,
      role: "owner",
      grants: [],
      ip: "1.1.1.1",
    }),
  };
}

/** The org's launch review marks (kind, page, status). */
export async function reviewMarksOf(
  org: string,
): Promise<{ kind: string; page: string; status: string }[]> {
  const pb = await superuser();
  const rows = await pb.collection("launch_review_marks").getFullList({
    filter: pb.filter("organization = {:org}", { org }),
  });
  return rows.map((r) => ({
    kind: String(r.kind ?? ""),
    page: String(r.page ?? ""),
    status: String(r.status ?? ""),
  }));
}

/** The org's support tickets (type, subject, target kind/id). */
export async function ticketsOf(
  org: string,
): Promise<{ type: string; subject: string; target: string }[]> {
  const pb = await superuser();
  const rows = await pb.collection("support_threads").getFullList({
    filter: pb.filter("organization = {:org} && kind = 'ticket'", { org }),
  });
  return rows.map((r) => {
    const target = (r.target ?? {}) as { kind?: unknown; id?: unknown };
    return {
      type: String(r.type ?? ""),
      subject: String(r.subject ?? ""),
      target: `${String(target.kind ?? "")}:${String(target.id ?? "")}`,
    };
  });
}

/** The org's form submissions (id, is_test). */
export async function testFlagsOf(
  org: string,
): Promise<{ id: string; isTest: boolean }[]> {
  const pb = await superuser();
  const rows = await pb.collection("form_submissions").getFullList({
    filter: pb.filter("organization = {:org}", { org }),
    sort: "created",
  });
  return rows.map((r) => ({ id: r.id, isTest: r.is_test === true }));
}

// form_submissions reads and the form rate-limit reset for apps/web forms tests (07-19). Like
// media-seed.ts, the superuser client stays inside packages/db (invariant 1): callers get
// plain fields back.
import { superuser } from "../src/client";
import {
  resetFormSubmitLimitsForTests,
  resetPageGateLimitsForTests,
} from "../src/rate-limit";

// 07-32: the page-gate limiter reset, for apps tests (they may not import packages/db/src).
export { resetFormSubmitLimitsForTests, resetPageGateLimitsForTests };

export type SubmissionRow = {
  id: string;
  page: string;
  spam: boolean;
  /** 10-38: the stored answers (file answers included). */
  data: Record<string, unknown>;
};

/** Every submission of one form, newest first. */
export async function submissionsOf(formId: string): Promise<SubmissionRow[]> {
  const pb = await superuser();
  const rows = await pb.collection("form_submissions").getFullList({
    filter: pb.filter("form = {:f}", { f: formId }),
    sort: "-created",
  });
  return rows.map((r) => ({
    id: r.id,
    page: typeof r.page === "string" ? r.page : "",
    spam: r.spam === true,
    data:
      typeof r.data === "object" && r.data !== null
        ? (r.data as Record<string, unknown>)
        : {},
  }));
}

/** 10-38: turn Builder Pro on (an active org_addons row) for one org, for apps upload tests. */
export async function grantBuilderPro(orgId: string): Promise<void> {
  const pb = await superuser();
  const existing = await pb
    .collection("org_addons")
    .getFirstListItem(
      pb.filter("organization = {:org} && addon = 'builder-pro'", {
        org: orgId,
      }),
    )
    .catch(() => null);
  const body = {
    organization: orgId,
    addon: "builder-pro",
    status: "active",
    disabled_reason: "",
    source: "billing",
    installed_version: "1.0.0",
    installed_at: new Date().toISOString(),
  };
  if (existing) await pb.collection("org_addons").update(existing.id, body);
  else await pb.collection("org_addons").create(body);
}

export type DraftRow = {
  id: string;
  email: string;
  tokenHash: string;
  data: unknown;
  expiresAt: string;
};

/** 10-37: every Forms Pro draft of one form (newest first), for drafts tests. */
export async function draftsOf(formId: string): Promise<DraftRow[]> {
  const pb = await superuser();
  const rows = await pb.collection("form_drafts").getFullList({
    filter: pb.filter("form = {:f}", { f: formId }),
    sort: "-created",
  });
  return rows.map((r) => ({
    id: r.id,
    email: String(r.email ?? ""),
    tokenHash: String(r.token_hash ?? ""),
    data: r.data,
    expiresAt: String(r.expires_at ?? ""),
  }));
}

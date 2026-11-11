// 15-28: read-only assertions for the apps/web P15 exit walk (marketing.integration.test.tsx).
// Keeps the superuser client inside packages/db (Invariant 1). Nothing here writes.
import { superuser } from "../src/client";

/** hub_inquiries rows for one visitor address (staff-only platform collection, P15-P14). */
export async function hubInquiryRowsFor(email: string): Promise<
  {
    name: string;
    email: string;
    business: string;
    topic: string;
    /** Every stored field name (WR-B06: no IP field). */
    fields: string[];
    /** The whole stored row as JSON, to prove no IP is in it. */
    stored: string;
  }[]
> {
  const pb = await superuser();
  const rows = await pb.collection("hub_inquiries").getFullList({
    filter: pb.filter("email = {:e}", { e: email }),
  });
  return rows.map((r) => ({
    name: String(r.name ?? ""),
    email: String(r.email ?? ""),
    business: String(r.business ?? ""),
    topic: String(r.topic ?? ""),
    fields: Object.keys(r),
    stored: JSON.stringify(r),
  }));
}

/** Every review_cases row's case number and kind. */
export async function reviewCaseRows(): Promise<
  { seq: number; kind: string }[]
> {
  const pb = await superuser();
  const rows = await pb.collection("review_cases").getFullList({
    fields: "seq,kind",
  });
  return rows.map((r) => ({ seq: Number(r.seq), kind: String(r.kind) }));
}

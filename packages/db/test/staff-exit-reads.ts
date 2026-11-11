// 13-48: read-only assertions for the apps/web staff exit walk. Keeps the superuser client
// inside packages/db (Invariant 1). Nothing here writes.
import { superuser } from "../src/client";

/** The staff-only rating stamp of one ticket (rated_agent is serverOnly, P13-P18). */
export async function ticketRatedAgent(number: number): Promise<string> {
  const pb = await superuser();
  const row = await pb
    .collection("support_threads")
    .getFirstListItem(
      pb.filter("number = {:n} && kind = 'ticket'", { n: number }),
      {
        fields: "rated_agent",
      },
    );
  return String(row.rated_agent ?? "");
}

/** audit_log rows of one action by one actor (platform rows carry no organization). */
export async function auditRowsByActor(
  actor: string,
  action: string,
): Promise<{ id: string; organization: string }[]> {
  const pb = await superuser();
  const rows = await pb.collection("audit_log").getFullList({
    filter: pb.filter("actor = {:u} && action = {:a}", { u: actor, a: action }),
  });
  return rows.map((r) => ({
    id: r.id,
    organization: String(r.organization ?? ""),
  }));
}

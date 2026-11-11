// "./server": the pure block-data transform (ADDON-02, ADDON-08; D253; RESEARCH Pattern 2;
// CONTEXT A5-Q2; T-05-45). The platform reads the published, not-held credentials through
// the org-scoped chokepoint (readPublicAddonRecords: public fields only) and passes them in
// with the request's `now`. Expired credentials are dropped here, at render, so they hide
// from the site the day after they expire with no job and no write. The number leaves this
// module only when show_number is on. Nothing here touches a context, env or a client.
// Erasable TypeScript only, no .tsx in its import chain.
import { dayOf, isExpired } from "./expiry";
import {
  validateCredentialsContent,
  type CredentialsBlockContent,
} from "./sections/definition";

/** What a Credentials block renders per item (public fields only). */
export type CredentialItemView = {
  id: string;
  title: string;
  issuer: string;
  /** Only when the owner turned on "Show number on site". */
  number: string | null;
  /** "YYYY-MM-DD" or "". */
  issued_on: string;
  /** "YYYY-MM-DD" or "". */
  expires_on: string;
  verify_url: string;
};

/** One group; category "" when the block is not grouped. */
export type CredentialGroupView = {
  category: string;
  items: CredentialItemView[];
};

type SectionRef = {
  id: string;
  section_type: string;
  content: Record<string, unknown>;
};

type RecordLike = { id: string } & Record<string, unknown>;

export const blockCollections = ["credentials"] as const;

/** Credentials with no group show under this heading, last (matches the hub list). */
export const OTHER_GROUP = "Other";

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function order(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function settings(content: unknown): CredentialsBlockContent {
  try {
    return validateCredentialsContent(content);
  } catch {
    return validateCredentialsContent({});
  }
}

/** sort_order, then id (stable). */
export function orderCredentials(records: readonly RecordLike[]): RecordLike[] {
  return [...records].sort((a, b) => {
    const d = order(a.sort_order) - order(b.sort_order);
    if (d !== 0) return d;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function toView(r: RecordLike): CredentialItemView {
  const number = str(r.credential_number);
  return {
    id: r.id,
    title: str(r.title),
    issuer: str(r.issuer),
    number: r.show_number === true && number !== "" ? number : null,
    issued_on: dayOf(r.issued_on),
    expires_on: dayOf(r.expires_on),
    verify_url: str(r.verify_url),
  };
}

/** Pure: the groups one block shows, from its settings and the org's public credentials. */
export function selectCredentials(
  content: unknown,
  records: readonly RecordLike[],
  now: Date,
): CredentialGroupView[] {
  const c = settings(content);
  const live = orderCredentials(
    records.filter(
      (r) =>
        typeof r.id === "string" &&
        str(r.title) !== "" &&
        !isExpired(r.expires_on, now),
    ),
  );
  if (live.length === 0) return [];
  if (!c.group_by_category) {
    return [{ category: "", items: live.map(toView) }];
  }
  const groups = new Map<string, CredentialItemView[]>();
  for (const r of live) {
    const g = str(r.category) || OTHER_GROUP;
    const list = groups.get(g);
    if (list) list.push(toView(r));
    else groups.set(g, [toView(r)]);
  }
  const other = groups.get(OTHER_GROUP);
  groups.delete(OTHER_GROUP);
  const out = [...groups].map(([category, items]) => ({ category, items }));
  return other ? [...out, { category: OTHER_GROUP, items: other }] : out;
}

export function blockData(
  sections: readonly SectionRef[],
  records: Readonly<Record<string, readonly RecordLike[]>>,
  now: Date,
): Record<string, CredentialGroupView[]> {
  const rows = Object.prototype.hasOwnProperty.call(records, "credentials")
    ? (records.credentials ?? [])
    : [];
  const out: Record<string, CredentialGroupView[]> = {};
  for (const s of sections) {
    if (s.section_type !== "credentials") continue;
    out[s.id] = selectCredentials(s.content, rows, now);
  }
  return out;
}

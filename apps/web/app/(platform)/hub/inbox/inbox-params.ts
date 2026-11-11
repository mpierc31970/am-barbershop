// Inbox URL params (CONT-25, D311; 07-19 choices 8 and 12). Pure; never throws. The URL keeps
// only tab, form, q and message. `view=filtered` (07-UI-SPEC) is an alias of `tab=filtered`
// (07-03's tab bar). Deep links: `/hub/inbox?tab=messages&message=<id>` (07-16) and
// `/hub/inbox?form=<formId>&message=<id>` (07-15's notification email) both open the drawer.
export const INBOX_PER_PAGE = 50;
const ID = /^[a-z0-9]{1,32}$/i;
const MAX_Q = 100;

export type InboxTab = "messages" | "filtered";

export interface InboxParams {
  tab: InboxTab;
  form?: string;
  q?: string;
  message?: string;
}

type Raw = Readonly<Record<string, string | string[] | undefined>>;

function first(raw: Raw | null | undefined, key: string): string | null {
  if (!raw || typeof raw !== "object") return null;
  if (!Object.prototype.hasOwnProperty.call(raw, key)) return null;
  let v: unknown = raw[key];
  if (Array.isArray(v)) v = v[0];
  return typeof v === "string" ? v : null;
}

export function parseInboxParams(raw: Raw | null | undefined): InboxParams {
  try {
    const tabRaw = first(raw, "tab") ?? first(raw, "view");
    const out: InboxParams = {
      tab: tabRaw === "filtered" ? "filtered" : "messages",
    };
    const form = first(raw, "form");
    if (form && ID.test(form)) out.form = form;
    const q = first(raw, "q")?.trim().slice(0, MAX_Q);
    if (q) out.q = q;
    const message = first(raw, "message");
    if (message && ID.test(message)) out.message = message;
    return out;
  } catch {
    return { tab: "messages" };
  }
}

/** `/hub/inbox?…` from the closed key set; `patch` keys set to undefined are dropped. */
export function inboxHref(
  params: InboxParams,
  patch: Partial<InboxParams> = {},
): string {
  const merged: InboxParams = { ...params, ...patch };
  const q = new URLSearchParams();
  q.set("tab", merged.tab === "filtered" ? "filtered" : "messages");
  if (merged.form && ID.test(merged.form)) q.set("form", merged.form);
  if (merged.q) q.set("q", merged.q.slice(0, MAX_Q));
  if (merged.message && ID.test(merged.message))
    q.set("message", merged.message);
  return `/hub/inbox?${q.toString()}`;
}

export function messageHref(id: string): string {
  return inboxHref({ tab: "messages", message: id });
}

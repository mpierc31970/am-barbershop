// Inbox URL builder, kept out of the "use client" InboxView so server panels can call it.
export function inboxHref(listSearch: string, open?: number | null): string {
  const qs = new URLSearchParams(listSearch);
  qs.delete("tab");
  qs.delete("open");
  const parts = new URLSearchParams({ tab: "inbox" });
  for (const [k, v] of qs) parts.append(k, v);
  if (open) parts.set("open", String(open));
  return `/staff/tickets?${parts.toString()}`;
}

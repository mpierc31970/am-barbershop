"use client";
// Inbox client wrapper (13-35 choice 2): binds InboxView to the 13-28 bulk action, client
// navigation (router.push, so Back closes the split pane) and the 60 s list refresh
// (router.refresh while the tab is visible, D-UI-P13-20). Shortcuts follow the staff toggle.
import {
  INBOX_REFRESH_MS,
  InboxView,
  useShortcutsEnabled,
  useVisibleInterval,
  type InboxViewProps,
} from "@cds/ui/staff";
import { useRouter } from "next/navigation";
import { staffBulkAction } from "../../../../actions/staff/tickets";

export type InboxIslandProps = Omit<
  InboxViewProps,
  "onBulk" | "onNavigate" | "shortcutsEnabled"
>;

export function InboxIsland(props: InboxIslandProps) {
  const router = useRouter();
  const [shortcuts] = useShortcutsEnabled();
  useVisibleInterval(() => router.refresh(), INBOX_REFRESH_MS);
  return (
    <InboxView
      {...props}
      onBulk={staffBulkAction}
      onNavigate={(href) => router.push(href)}
      shortcutsEnabled={shortcuts}
    />
  );
}

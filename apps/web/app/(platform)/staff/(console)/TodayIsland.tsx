"use client";
// Today's refresh island (13-47 choice 3; D-UI-P13-20): router.refresh() every 60 s while the
// tab is visible and on window focus, silently (no live region), and the "(3)" title prefix.
import { TodayRefresher } from "@cds/ui/staff";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

export function TodayIsland({ attention }: { attention: number }) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  return <TodayRefresher onRefresh={refresh} attention={attention} />;
}

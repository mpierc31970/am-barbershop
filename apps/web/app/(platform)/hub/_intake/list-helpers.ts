"use client";
// Shared by the Team and Services sections (06-20; 06-UI-SPEC "Team, Services"): the
// CSV download, initials, the price line and the URL-held drawer (?record=).
import type { CsvFile } from "@cds/ui/hub";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { ServiceView } from "../../../../lib/intake";

/** Where the list is shown: the setup step, Settings, or Website › Services. */
export type ListContext = "setup" | "settings" | "website";

export function download(file: CsvFile): void {
  const blob = new Blob([file.csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** "Maria Lopez" -> "ML", "Cher" -> "C". */
/**
 * Undo of a removed row: put it back where it was (index clamped to the list), as the
 * server's restore does, not at the end (C-WR-09). A row already back is left alone.
 */
export function reinsertAt<T extends { id: string }>(
  list: readonly T[],
  item: T,
  index: number,
): T[] {
  if (list.some((x) => x.id === item.id)) return [...list];
  const at = Math.max(0, Math.min(index, list.length));
  return [...list.slice(0, at), item, ...list.slice(at)];
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]!.charAt(0);
  const last = words.length > 1 ? words[words.length - 1]!.charAt(0) : "";
  return `${first}${last}`.toUpperCase();
}

/** 4500 -> "$45", 4550 -> "$45.50". */
export function formatMoney(cents: number): string {
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  const dollars = whole.toLocaleString("en-US");
  return frac === 0
    ? `$${dollars}`
    : `$${dollars}.${String(frac).padStart(2, "0")}`;
}

/** "$45", "45.00", "1,200" -> cents; null when it isn't an amount (the server re-checks). */
export function parseMoney(raw: string): number | null {
  const t = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return cents > 0 ? cents : null;
}

/** "From $45 · 60 min", "$45", "Free", "Ask for a price". */
export function priceLine(
  s: Pick<ServiceView, "price_display" | "price_cents" | "duration_minutes">,
): string {
  let price: string;
  switch (s.price_display) {
    case "free":
      price = "Free";
      break;
    case "ask":
      price = "Ask for a price";
      break;
    case "from":
      price = s.price_cents ? `From ${formatMoney(s.price_cents)}` : "From";
      break;
    default:
      price = s.price_cents ? formatMoney(s.price_cents) : "";
  }
  const parts = [price];
  if (s.duration_minutes) parts.push(`${s.duration_minutes} min`);
  return parts.filter(Boolean).join(" · ");
}

/**
 * The open drawer, held in the URL as ?record=<prefix>-<id> or <prefix>-new so a refresh
 * and Back keep it. Local state leads (the URL follows), so the drawer opens at once.
 */
export function useRecordParam(prefix: string) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const initial = search?.get("record") ?? null;
  const [value, setValue] = useState<string | null>(
    initial && initial.startsWith(`${prefix}-`)
      ? initial.slice(prefix.length + 1)
      : null,
  );

  function hrefWith(record: string | null): string {
    const params = new URLSearchParams(search?.toString() ?? "");
    if (record === null) params.delete("record");
    else params.set("record", `${prefix}-${record}`);
    const q = params.toString();
    return `${pathname ?? ""}${q ? `?${q}` : ""}`;
  }

  return {
    /** "new", a record id, or null when closed. */
    value,
    open(record: string) {
      setValue(record);
      router.replace(hrefWith(record), { scroll: false });
    },
    close() {
      setValue(null);
      router.replace(hrefWith(null), { scroll: false });
    },
  };
}

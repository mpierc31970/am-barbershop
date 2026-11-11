// Forms monitor status (D174, D175, D234; T-07-15-12; 07-15 choice 16). Monitor-safe: counts
// and states only, never tenant content or addresses. The stand-in scanner reports "off"
// (fail closed: upload fields hidden, forms still submit); clamd is pinged.
import { formsNotifyStats } from "./notify";
import { clamdAddress, clamdPing, getFileScanner } from "./scanner";
import type { FileScanner } from "./scanner-port";

export type FormsStatus = {
  scanner: "unavailable" | "clamd";
  scanner_status: "off" | "ok" | "down";
  notify_failures_24h: number;
};

export async function formsStatus(
  deps: { scanner?: FileScanner; ping?: () => Promise<boolean> } = {},
): Promise<FormsStatus> {
  const notify_failures_24h = formsNotifyStats().failures24h;
  let scanner: FileScanner;
  try {
    scanner = deps.scanner ?? getFileScanner();
  } catch {
    // Misconfigured clamd: uploads are refused until it is fixed.
    return { scanner: "clamd", scanner_status: "down", notify_failures_24h };
  }
  if (scanner.name === "unavailable") {
    return {
      scanner: "unavailable",
      scanner_status: "off",
      notify_failures_24h,
    };
  }
  let up = false;
  try {
    up = await (deps.ping ?? (() => clamdPing(clamdAddress())))();
  } catch {
    up = false;
  }
  return {
    scanner: "clamd",
    scanner_status: up ? "ok" : "down",
    notify_failures_24h,
  };
}

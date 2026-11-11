// TestModeStrip (10-08; 10-UI-SPEC "Test pages", D-UI-P10-8): the first element on every
// fake-adapter payment page, so a test page can never pass for a real one (T-10-08-02).
import { TriangleAlert } from "lucide-react";

export const TEST_STRIP_TEXT = "Test payment page. No real money moves.";

export function TestModeStrip() {
  return (
    <div
      role="note"
      className="flex h-10 w-full items-center justify-center gap-2 bg-hub-warning-tint px-4 font-hub text-sm font-semibold text-hub-warning"
    >
      <TriangleAlert size={14} aria-hidden="true" className="shrink-0" />
      <span>{TEST_STRIP_TEXT}</span>
    </div>
  );
}

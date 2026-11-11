"use client";
// One autosaved business-profile field (06-19; 06-UI-SPEC "Stages" autosave contract; ONB-02,
// D-UI-P6-19). Shared by the setup steps and Settings (06-22): the field group gets an
// `onSave(patch)` from its host (saveProfileAction("business" | "contact", patch) in setup),
// and each field saves { [key]: value } through its own queue, reported to the StageFrame's
// status (outside a frame the context is a no-op and the field keeps its own status).
// A value already sent is skipped unless the last send failed; a server refusal (invalid) is
// exposed as `error` for the field's error line.
import type { HubActionResult } from "@cds/ui/hub";
import { useRef } from "react";
import { useStageAutosave } from "../setup/[stage]/StageFrame";

export type Patch = Record<string, unknown>;
export type ProfileSave = (patch: Patch) => Promise<HubActionResult<unknown>>;

const merge = (a: Patch, b: Patch): Patch => ({ ...a, ...b });

export function useProfileField(
  key: string,
  initial: unknown,
  onSave: ProfileSave,
  opts: { debounceMs?: number } = {},
) {
  const auto = useStageAutosave<Patch>(`profile.${key}`, onSave, {
    merge,
    ...(opts.debounceMs ? { debounceMs: opts.debounceMs } : {}),
  });
  const last = useRef(JSON.stringify(initial));
  return {
    save(value: unknown) {
      const k = JSON.stringify(value);
      if (
        k === last.current &&
        auto.status !== "invalid" &&
        auto.status !== "error"
      ) {
        return;
      }
      last.current = k;
      auto.run({ [key]: value });
    },
    status: auto.status,
    error: auto.status === "invalid" ? auto.failure?.message : undefined,
  };
}

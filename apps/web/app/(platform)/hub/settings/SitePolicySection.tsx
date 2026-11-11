"use client";
// Settings › Legal section 2 client island (09-23; AGR-08; D217). Adapts the two Server
// Actions (ActionResult) to SitePolicyPanel's plain callbacks; everything else is server-built
// props from LegalPanel. The actions re-derive the org and role from the session cookie.
import { SitePolicyPanel, type SitePolicyPanelProps } from "@cds/ui/hub/legal";
import {
  previewSitePolicyAction,
  publishSitePoliciesAction,
} from "../../../actions/site-policies";

const ERR_LOAD = "We couldn't load this. Check your connection and try again.";

export type SitePolicySectionProps = Omit<
  SitePolicyPanelProps,
  "onPreview" | "onPublish"
>;

export function SitePolicySection(props: SitePolicySectionProps) {
  return (
    <SitePolicyPanel
      {...props}
      onPreview={async (page) => {
        try {
          const res = await previewSitePolicyAction(page);
          return res.ok ? res.data : { error: res.message };
        } catch {
          return { error: ERR_LOAD };
        }
      }}
      onPublish={async () => {
        try {
          const res = await publishSitePoliciesAction();
          return res.ok ? { ok: true } : { ok: false, message: res.message };
        } catch {
          return { ok: false };
        }
      }}
    />
  );
}

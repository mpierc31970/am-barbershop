"use client";
// GateRuleList (14-38 choice 2; DOM-05, D58; 14-UI-SPEC GateReport "GateRuleList"). Rule (G1-G7
// with the plain name) · Result (`h-ok` Pass / `g-mismatch` Fail / `g-override` "Overridden by
// Lee" with the reason in `title` / `g-ack` "Acknowledged by owner") · Hard block (Label
// "No override" for G1-email, G3, G6) · Action: a super_admin secondary sm **Override** on an
// overridable failing rule → (server step-up) → CaseDialog "Override G2 for riverabakery.com?"
// with a required 10-500 reason, **Override** / **Keep the block** (focused). Hard blocks render
// no button; a support_agent sees "Super Admin only" (T-14-38-02). A plain semantic table in
// the StaffTable look (rules have no page to link to).
import { P14_COPY } from "@cds/core/dns";
import { useState } from "react";
import { Badge } from "../../hub/Badge";
import { Button } from "../../hub/Button";
import { CaseDialog } from "../dialogs";
import {
  DOMAIN_TABLE as T,
  STAFF_DOMAIN_COPY,
  type StaffDomainOverrideAction,
  type StaffGateRuleData,
} from "./copy";
import { SuperOnly, useDomainRun } from "./parts";

const C = STAFF_DOMAIN_COPY.gate;

export interface GateRuleListProps {
  orgId: string;
  domain: string;
  rules: readonly StaffGateRuleData[];
  /** The viewer is super_admin. */
  canSuper: boolean;
  /** Override a rule; omitted = no Action column buttons (read-only, reverse mode). */
  override?: StaffDomainOverrideAction;
}

function ResultBadge({ rule }: { rule: StaffGateRuleData }) {
  switch (rule.result) {
    case "pass":
      return <Badge tone="h-ok">{C.pass}</Badge>;
    case "fail":
      return <Badge tone="g-mismatch">{C.fail}</Badge>;
    case "overridden":
      return (
        <span title={rule.reason || undefined}>
          <Badge tone="g-override">
            {rule.overriddenBy
              ? C.overriddenBy(rule.overriddenBy)
              : C.overridden}
          </Badge>
          {rule.reason ? (
            <span className="sr-only">: {rule.reason}</span>
          ) : null}
        </span>
      );
    default:
      return <Badge tone="g-ack">{C.acknowledged}</Badge>;
  }
}

export function GateRuleList({
  orgId,
  domain,
  rules,
  canSuper,
  override,
}: GateRuleListProps) {
  const [target, setTarget] = useState<StaffGateRuleData | null>(null);
  return (
    <div className="overflow-x-auto">
      <table className={T.table} data-gate-rules="">
        <caption className="sr-only">{C.rulesCaption}</caption>
        <thead>
          <tr className={T.headRow}>
            <th scope="col" className={T.th}>
              {C.rule}
            </th>
            <th scope="col" className={T.th}>
              {C.result}
            </th>
            <th scope="col" className={T.th}>
              {C.hardBlock}
            </th>
            <th scope="col" className={T.th}>
              {C.action}
            </th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => {
            const canOverride =
              r.result === "fail" && r.overridable && !r.hardBlock;
            return (
              <tr key={r.rule} className={T.row} data-rule={r.rule}>
                <th scope="row" className={`${T.td} font-semibold`}>
                  {r.name}
                </th>
                <td className={T.td}>
                  <ResultBadge rule={r} />
                </td>
                <td className={`${T.td} text-hub-ink-muted`}>
                  {r.hardBlock ? P14_COPY.NO_OVERRIDE : ""}
                </td>
                <td className={T.td}>
                  {canOverride && override ? (
                    canSuper ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={`${P14_COPY.BTN_OVERRIDE} ${r.rule}`}
                        onClick={() => setTarget(r)}
                      >
                        {P14_COPY.BTN_OVERRIDE}
                      </Button>
                    ) : (
                      <SuperOnly label={P14_COPY.BTN_OVERRIDE} />
                    )
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {override && canSuper ? (
        <OverrideDialog
          orgId={orgId}
          domain={domain}
          rule={target}
          onClose={() => setTarget(null)}
          action={override}
        />
      ) : null}
    </div>
  );
}

function OverrideDialog({
  orgId,
  domain,
  rule,
  onClose,
  action,
}: {
  orgId: string;
  domain: string;
  rule: StaffGateRuleData | null;
  onClose: () => void;
  action: StaffDomainOverrideAction;
}) {
  const { run } = useDomainRun(
    action,
    `${P14_COPY.BTN_OVERRIDE} ${rule?.rule ?? ""}: ${domain}`,
  );
  return (
    <CaseDialog
      open={rule !== null}
      onClose={onClose}
      safeFocus
      title={C.overrideTitle(rule?.rule ?? "", domain)}
      consequence={C.overrideBody}
      caseRows={[
        [C.rule, rule?.name ?? ""],
        [STAFF_DOMAIN_COPY.timeline.domain, domain],
      ]}
      reasonField={{
        label: STAFF_DOMAIN_COPY.timeline.reason,
        helper: STAFF_DOMAIN_COPY.timeline.reasonHelper,
        min: 10,
        max: 500,
      }}
      confirmLabel={P14_COPY.BTN_OVERRIDE}
      safeLabel={P14_COPY.BTN_KEEP_BLOCK}
      onConfirm={(values) =>
        rule ? run(orgId, rule.rule, values.reason ?? "") : null
      }
    />
  );
}

// HostsTable (14-38 choice 2; DOM-08, P14-P5; 14-UI-SPEC DomainSummary "HostsTable"). Host ·
// Kind (`preview` / `custom` / `redirect → riverabakery.com`) · Primary · Verified · HTTPS /
// cert days. A plain semantic table in the StaffTable look (caption, th scope=col): host rows
// have no page to link to, so StaffTable's primary link does not apply. Hosts are text nodes.
import {
  DOMAIN_TABLE as T,
  STAFF_DOMAIN_COPY,
  type StaffDomainHostData,
} from "./copy";

const C = STAFF_DOMAIN_COPY.hosts;

export interface HostsTableProps {
  hosts: readonly StaffDomainHostData[];
}

export function hostKindWords(h: StaffDomainHostData): string {
  if (h.kind === "redirect" && h.redirectTo) return C.redirect(h.redirectTo);
  return h.kind;
}

export function hostHttpsWords(h: StaffDomainHostData): string {
  const https =
    h.httpsOk === null ? C.unknown : h.httpsOk ? C.httpsOk : C.httpsFailing;
  return h.certDays === null ? https : `${https} · ${C.certDays(h.certDays)}`;
}

export function HostsTable({ hosts }: HostsTableProps) {
  if (hosts.length === 0) {
    return <p className="font-hub text-sm text-hub-ink-muted">{C.empty}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className={T.table} data-hosts-table="">
        <caption className="sr-only">{C.caption}</caption>
        <thead>
          <tr className={T.headRow}>
            <th scope="col" className={T.th}>
              {C.host}
            </th>
            <th scope="col" className={T.th}>
              {C.kind}
            </th>
            <th scope="col" className={T.th}>
              {C.primary}
            </th>
            <th scope="col" className={T.th}>
              {C.verified}
            </th>
            <th scope="col" className={T.th}>
              {C.https}
            </th>
          </tr>
        </thead>
        <tbody>
          {hosts.map((h) => (
            <tr key={h.host} className={T.row} data-host={h.host}>
              <td className={`${T.td} ${T.value}`}>{h.host}</td>
              <td className={`${T.td} break-all`}>{hostKindWords(h)}</td>
              <td className={T.td}>{h.primary ? C.yes : C.no}</td>
              <td className={T.td}>{h.verified ? C.yes : C.no}</td>
              <td
                className={
                  T.td +
                  (h.httpsOk === false ? " font-semibold text-hub-danger" : "")
                }
              >
                {hostHttpsWords(h)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

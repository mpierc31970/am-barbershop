// Leaving CDS view mapping (14-42 choices 3 and 4; LIFE-01). Server-only: it maps the @cds/db
// handback and checklist reads to the plain owner-view props of @cds/ui/hub/leaving (the UI
// package never imports @cds/db). Records keep type, name, value and priority only (no
// sources, no ttl). Dates are formatted like the emails (en-GB, UTC: "14 Nov 2026"), so the
// page and the started email name the same day.
import { ADDON_REGISTRY } from "@cds/addon-registry";
import {
  registrarFromRdapName,
  registrarName,
  type DnsRecord,
} from "@cds/core/dns";
import type { HandbackZoneView, OffboardingManifestInput } from "@cds/db";
import type { HandbackRecordView, HandbackZoneUi } from "@cds/ui/hub/leaving";

const LONG = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const SHORT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** "14 Nov 2026" (empty for a bad date). */
export function longDay(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? "" : LONG.format(new Date(t));
}

/** "14 Nov" (empty for a bad date). */
export function shortDay(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? "" : SHORT.format(new Date(t));
}

function record(r: DnsRecord): HandbackRecordView {
  return {
    type: r.type,
    name: r.name,
    value: r.value,
    ...(typeof r.priority === "number" ? { priority: r.priority } : {}),
  };
}

/** The owner view of one domain's handback. */
export function toHandbackUi(z: HandbackZoneView): HandbackZoneUi {
  const id = registrarFromRdapName(z.registrar);
  const name =
    id === "other"
      ? (z.registrar ?? "").trim().slice(0, 80) || registrarName("other")
      : registrarName(id);
  return {
    domain: z.domain,
    registrarId: id,
    registrarName: name,
    groups: {
      copy_exactly: z.groups.copy_exactly.map(record),
      points_to_cds: z.groups.points_to_cds.map(record),
      remove: z.groups.remove.map(record),
    },
    destination: z.destination,
    destinationNameservers: [...z.destinationNameservers],
    cdsNameservers: [...z.cdsNameservers],
    results: z.results.map((r) => ({
      record: record(r.record),
      found: r.found,
    })),
    canCheckBefore: z.canCheckBefore,
    status: z.status,
    message: z.message,
  };
}

/** The registry's Leaving CDS data for offboardingChecklist (P14-P28; P13-P7). */
export function offboardingManifests(): OffboardingManifestInput[] {
  return ADDON_REGISTRY.list().map((m) => ({
    slug: m.slug,
    name: m.name,
    ...(m.offboarding ? { offboarding: m.offboarding } : {}),
  }));
}

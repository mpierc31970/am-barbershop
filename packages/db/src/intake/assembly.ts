// The P8 assembly contract (ONB-03, CONTEXT A3-Q3): every intake field, core and add-on,
// with its fallback already applied. A present field comes back as { value, source:
// "provided" }; an empty optional field as { value: fallbackText(rule), source: "fallback" }
// (null when the rule has no text: the section is omitted, or CDS decides at build time). A
// required field that is somehow missing (Send to CDS refuses that) comes back as a null
// fallback, so P8 never has to guess. Business read; nothing here writes.
import type { AddonRegistry } from "@cds/core/addons";
import {
  addonIntakeFields,
  fallbackText,
  INTAKE_FIELDS,
  type IntakeField,
  type IntakeSnapshot,
} from "@cds/core/intake";
import type {
  AssembledValue,
  AssemblyIntake,
  AssemblyMediaRef,
} from "@cds/core/templates";
import type { OrgContext } from "../context";
import { runRead } from "./shared";
import { loadIntake, type LoadedIntake } from "./snapshot";

// AssembledValue / AssemblyIntake live in @cds/core/templates (08-01, RESEARCH R-1), declared
// from structural core types; re-exported here so every existing import keeps compiling.
export type { AssembledValue, AssemblyIntake } from "@cds/core/templates";

/** The provided value of each core field, as P8 consumes it. */
function coreValue(id: string, l: LoadedIntake): unknown {
  const s = l.snapshot;
  const p = s.profile;
  switch (id) {
    case "org_name":
      return s.orgName;
    case "path":
      return s.path;
    case "business_type":
      return p.business_type.trim() !== ""
        ? p.business_type
        : p.business_type_other;
    case "logo":
      return l.media.logo[0] ?? null;
    case "contact_method":
      return { phone: p.phone, email: p.public_email };
    case "email_delivery":
      return l.defaultAddress;
    case "services":
      return l.services;
    case "team":
      return l.team;
    case "hero":
      return l.media.hero[0] ?? null;
    case "gallery":
      return l.media.gallery;
    case "moodboard":
      return l.media.moodboard;
    case "photo_descriptions":
      return true;
    case "domain_choice":
      return {
        choice: s.answers.domain_choice,
        domain: s.answers.domain,
        registrar: s.answers.registrar,
        ideas: s.answers.domain_ideas,
      };
    case "gbp":
      return s.answers.gbp;
    default:
      return Object.hasOwn(p, id) ? p[id as keyof typeof p] : null;
  }
}

/** Provided values of add-on intake fields, keyed by their IntakeField id. */
function addonValues(
  registry: AddonRegistry,
  l: LoadedIntake,
): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const slug of l.intake.selections.addons) {
    const intake = registry.get(slug)?.intake;
    if (!intake) continue;
    const cfg = l.intake.addonConfig[slug];
    if (intake.records) {
      out.set(`addon_${slug}_records`, cfg?.records ?? []);
    }
    for (const f of intake.fields ?? []) {
      out.set(`addon_${slug}_${f.id}`, cfg?.fields[f.id] ?? null);
    }
  }
  return out;
}

function assemble(
  f: IntakeField,
  s: IntakeSnapshot,
  provided: () => unknown,
): AssembledValue<unknown> {
  if (f.present(s)) return { value: provided(), source: "provided" };
  if (f.required === true) return { value: null, source: "fallback" };
  return { value: fallbackText(f.fallback.rule, s), source: "fallback" };
}

/** Every intake field with fallbacks applied, for the P8 build (business read). */
export async function getIntakeForAssembly(
  ctx: OrgContext,
  registry: AddonRegistry,
): Promise<AssemblyIntake> {
  return runRead(ctx, async (pb) => {
    const l = await loadIntake(pb, ctx);
    const s = l.snapshot;
    const extra = addonIntakeFields(registry, l.intake.selections);
    const addon = addonValues(registry, l);
    const fields: Record<string, AssembledValue<unknown>> = {};
    for (const f of INTAKE_FIELDS) {
      fields[f.id] = assemble(f, s, () => coreValue(f.id, l));
    }
    for (const f of extra) {
      fields[f.id] = assemble(f, s, () => addon.get(f.id) ?? null);
    }
    // CONTEXT A3-Q5, A4-Q2: media_assets has no review flag. An intake description is typed
    // by the owner on purpose (D280), so a non-empty alt counts as reviewed; an empty one is
    // the P7 alt-backfill flag. Every id comes from loadIntake's org-scoped live rows, so no
    // other org's alt can reach the template (invariant 1, T-08-01-04).
    const ref = (id: string): AssemblyMediaRef => {
      const alt = l.mediaAlt.get(id) ?? "";
      return { id, alt, alt_reviewed: alt !== "" };
    };
    const first = (ids: readonly string[]) =>
      ids[0] === undefined ? null : ref(ids[0]);
    return {
      orgId: ctx.orgId,
      path: s.path,
      fields,
      team: l.team,
      services: l.services,
      media: {
        logo: first(l.media.logo),
        hero: first(l.media.hero),
        gallery: l.media.gallery.map(ref),
      },
      addonConfig: l.intake.addonConfig,
      selections: l.intake.selections,
      moodboardProposal: l.intake.moodboardProposal,
    };
  });
}

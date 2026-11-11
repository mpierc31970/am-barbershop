// The intake snapshot (ONB-01, ONB-02, ONB-03): one read of everything the pure still-needed
// rules (@cds/core/intake stillNeeded / stageStatus) look at. loadIntake() is the internal
// loader that assembly.ts and send.ts share, so all three read the same way inside one client.
// Reads: business read (Owner / Admin / Editor). Nothing here writes.
import { ADDON_PATHS, type AddonPath } from "@cds/core/addons";
import type { BusinessProfileValues, IntakeSnapshot } from "@cds/core/intake";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import type { OrgContext } from "../context";
import { linksOfRows, readSocialRows } from "../social/rows";
import { profileFromRow } from "./business-profile";
import { intakeFromRow, type OrgIntake } from "./org-intake";
import { toService, type Service } from "./services";
import { orgList, orgRow, runRead } from "./shared";
import { toTeamMember, type TeamMember } from "./team";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

type MediaKind = "logo" | "hero" | "gallery" | "team" | "moodboard";

export type LoadedIntake = {
  snapshot: IntakeSnapshot;
  intake: OrgIntake;
  intakeRowId: string | null;
  stage: string;
  team: TeamMember[];
  services: Service[];
  /** Live media ids by kind, in display order. */
  media: Record<MediaKind, string[]>;
  /** Trimmed `alt` of every live media row, by id (same org-scoped read; 08-01). */
  mediaAlt: ReadonlyMap<string, string>;
  defaultAddress: string;
};

/** Everything the snapshot, assembly and Send to CDS read, in the caller's client. */
export async function loadIntake(
  pb: PocketBase,
  ctx: OrgContext,
): Promise<LoadedIntake> {
  const org = await pb
    .collection("organizations")
    .getOne(ctx.orgId, { fields: "name,path,stage" });
  const orgName = str(org.name);
  const path = (ADDON_PATHS as readonly string[]).includes(str(org.path))
    ? (str(org.path) as AddonPath)
    : "";
  const [
    profileRow,
    intakeRow,
    teamRows,
    serviceRows,
    mediaRows,
    routes,
    socialRows,
  ] = await Promise.all([
    orgRow(pb, ctx, "business_profile"),
    orgRow(pb, ctx, "org_intake"),
    orgList(pb, ctx, "team_members"),
    orgList(pb, ctx, "services"),
    pb.collection("media_assets").getFullList({
      filter: pb.filter("organization = {:org} && removed_at = ''", {
        org: ctx.orgId,
      }),
      sort: "sort_order,created,id",
    }),
    pb.collection("org_email_routes").getFullList({
      filter: pb.filter("organization = {:org}", { org: ctx.orgId }),
      sort: "created,id",
    }),
    // 11-35 (DASH-14): social links live in social_accounts.
    readSocialRows(pb, ctx.orgId),
  ]);

  const values: Partial<ReturnType<typeof profileFromRow>> = profileFromRow(
    profileRow,
    orgName,
    linksOfRows(socialRows),
  );
  delete values.id;
  delete values.orgName;
  const profile = values as BusinessProfileValues;
  const intake = intakeFromRow(intakeRow);
  const services = serviceRows.map(toService);

  const media: Record<MediaKind, string[]> = {
    logo: [],
    hero: [],
    gallery: [],
    team: [],
    moodboard: [],
  };
  const byId = new Map<string, RecordModel>();
  const mediaAlt = new Map<string, string>();
  for (const m of mediaRows) {
    byId.set(m.id, m);
    mediaAlt.set(m.id, str(m.alt).trim());
    const kind = str(m.kind) as MediaKind;
    if (Object.hasOwn(media, kind)) media[kind].push(m.id);
  }
  // A-WR-06: a member whose photo was removed has no photo (Undo relinks it), so the
  // snapshot, Send to CDS and the P8 assembly never see a removed asset.
  const liveTeamPhotos = new Set(media.team);
  const team = teamRows
    .map(toTeamMember)
    .map((t) =>
      t.photoId !== null && !liveTeamPhotos.has(t.photoId)
        ? { ...t, photoId: null }
        : t,
    );
  const noAlt = (id: string | null | undefined) =>
    typeof id === "string" &&
    byId.has(id) &&
    str(byId.get(id)!.alt).trim() === "";
  // D280: saved team photos, gallery photos and the hero need a description.
  const photosMissingAlt =
    team.filter((t) => noAlt(t.photoId)).length +
    media.gallery.filter(noAlt).length +
    media.hero.slice(0, 1).filter(noAlt).length;

  const confirmedDefault = routes.find(
    (r) =>
      r.purpose === "default" &&
      str(r.confirmed_at) !== "" &&
      str(r.bounced_at) === "",
  );

  const addonIntake: IntakeSnapshot["addonIntake"] = {};
  for (const [slug, cfg] of Object.entries(intake.addonConfig)) {
    addonIntake[slug] = { records: cfg.records.length, fields: cfg.fields };
  }

  const snapshot: IntakeSnapshot = {
    orgName,
    path,
    profile,
    answers: intake.answers,
    counts: {
      services: services.length,
      team: team.length,
      gallery: media.gallery.length,
      moodboard: media.moodboard.length,
    },
    media: {
      logo: media.logo.length > 0,
      hero: media.hero.length > 0,
      photosMissingAlt,
    },
    email: {
      defaultConfirmed: routes.some(
        (r) => r.purpose === "default" && str(r.confirmed_at) !== "",
      ),
      bouncing: routes.filter((r) => str(r.bounced_at) !== "").length,
    },
    addonIntake,
    selections: intake.selections,
    stagesSaved: intake.stagesSaved,
  };

  return {
    snapshot,
    intake,
    intakeRowId: intakeRow?.id ?? null,
    stage: str(org.stage),
    team,
    services,
    media,
    mediaAlt,
    defaultAddress: str(confirmedDefault?.address),
  };
}

/** The snapshot stillNeeded / stageStatus / setupProgress read (business read). */
export async function getIntakeSnapshot(
  ctx: OrgContext,
): Promise<IntakeSnapshot> {
  return runRead(ctx, async (pb) => (await loadIntake(pb, ctx)).snapshot);
}

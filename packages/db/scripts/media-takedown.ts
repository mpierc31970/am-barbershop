// Staff media takedown (07-27; D249, CONT-33; choice 9 and 10). Prints the case (site, file,
// kind, size, public or not, pages using it), asks y/N, then deletes the row with a
// `media_assets.takedown` audit row carrying the reason, removes the file from both stores
// and purges the CDN. super_admin only (media_takedown), after a CDS staff MFA sign-in.
// A takedown always hard-deletes, even when pages use the file (D249).
//
// Usage:
//   npm run media:takedown -- --org <org-id> --asset <asset-id> --reason "<text>" [--dry-run] [--yes]
//   npm run media:takedown -- --help
// --dry-run still signs in (reading the case is staff-only) but deletes nothing.
// A CLI cannot reach Next's cache: pages refresh within 5 minutes (tenant page cache).
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by
// the npm script). Credentials, codes and storage keys are never printed.
import "@cds/addon-registry/server";
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { Forbidden, NotFound } from "@cds/core";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import { recordingInvalidator } from "../src/content/ports";
import { formatGb } from "../src/media/cdn/usage";
import {
  describeTakedown,
  takedownMedia,
  type TakedownDeps,
} from "../src/media/ops/takedown";
import {
  ask,
  CliFail,
  fail,
  ORG_RE,
  parseArgs,
  reasonArg,
  runMain,
  safeText,
  signInStaffInteractive,
  wantsHelp,
} from "./staff-cli";

const USAGE = `media:takedown - take one media file down (super_admin, MFA)

  npm run media:takedown -- --org <org-id> --asset <asset-id> --reason "<text>" [--dry-run] [--yes]
  npm run media:takedown -- --help

--org      the site the file belongs to
--asset    the media file id (from the hub's media drawer or PB admin)
--reason   why (1-500 characters), written to the audit log
--dry-run  sign in and print the case, without deleting
--yes      skip the y/N confirm after the case is printed
The file is deleted even when pages use it; those pages simply stop showing it.
Prompts for staff email, password and the emailed sign-in code.
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)`;

const TAKEN_DOWN =
  "Taken down. The file is gone from the site and the CDN; pages refresh within 5 minutes.";
const NOT_ALLOWED = "Only a super admin can take media down.";

function deps(): TakedownDeps {
  return {
    sections: composeSectionRegistry(CORE_SECTIONS, ADDON_REGISTRY.sections()),
    // No Next cache to invalidate from a CLI; the tenant page cache (<= 300 s) catches up.
    invalidator: recordingInvalidator(),
  };
}

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 ** 3) return formatGb(bytes);
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(0, Math.round(bytes / 1024))} KB`;
}

function mapRefusal(err: unknown): unknown {
  if (err instanceof Forbidden)
    return new CliFail(NOT_ALLOWED, { plain: true });
  if (err instanceof NotFound) return new CliFail("no such file for that site");
  return err;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), {
    known: ["--org", "--asset", "--reason", "--dry-run", "--yes"],
    withValue: ["--org", "--asset", "--reason"],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }
  const org = args.get("--org");
  if (typeof org !== "string") fail("--org <org-id> is required");
  if (!ORG_RE.test(org)) fail("--org is not a valid organization id");
  const asset = args.get("--asset");
  if (typeof asset !== "string") fail("--asset <asset-id> is required");
  if (!ORG_RE.test(asset)) fail("--asset is not a valid media id");
  const reason = reasonArg(args);

  const ctx = await signInStaffInteractive();
  const d = deps();
  let c;
  try {
    c = await describeTakedown(ctx, org, asset, d);
  } catch (err) {
    throw mapRefusal(err);
  }
  console.log(`Site:      ${safeText(c.orgName || "-")} (${org})`);
  console.log(`File:      ${safeText(c.asset.name || "-")} (${c.asset.id})`);
  console.log(`Kind:      ${c.asset.kind}`);
  console.log(`Size:      ${sizeLabel(c.asset.bytes)}`);
  console.log(`Public:    ${c.asset.public ? "yes" : "no"}`);
  if (c.asset.deleted) console.log("Note:      the owner already deleted it");
  console.log(
    c.usedOn.length > 0
      ? `Used on:   ${safeText(c.usedOn.join(", "))}`
      : "Not used on any page",
  );

  if (args.has("--dry-run")) {
    console.log("DRY RUN nothing deleted");
    return;
  }
  if (!args.has("--yes")) {
    const answer = await ask("Take down this file? (y/N) ");
    if (!/^y(es)?$/i.test(answer)) {
      console.log("Cancelled. Nothing was deleted.");
      return;
    }
  }
  try {
    await takedownMedia(ctx, { orgId: org, assetId: asset, reason }, d);
  } catch (err) {
    throw mapRefusal(err);
  }
  console.log(TAKEN_DOWN);
}

runMain(main);

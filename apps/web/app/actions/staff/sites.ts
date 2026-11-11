"use server";
// Site detail actions (13-33 choice 3; STAFF-02, ADDON-09, D21; Invariants 3 and 9;
// T-13-33-01, T-13-33-03). Public POST endpoints: every argument is untrusted. Each is a thin
// caller of the exact @cds/db function the `addons:install` CLI calls:
//   addons:install            -> installAddonAsStaff   (addon_install, super_admin, step-up)
//   addons:install --uninstall -> uninstallAddonAsStaff (same)
// runStaffAction re-reads the staff session and STAFF_MATRIX ("addon_install") and refuses a
// stale sign-in with step_up_needed before any call; installAddonAsStaff checks the matrix
// again, writes the audit row with the reason, and seeds rows only (an install is never a
// migration). Uninstall disables and retains. Errors are logged by class name only.
// 13-43 choice 2 adds postToSiteAction, routed exactly like `cds:post` (cds_post, both roles,
// no step-up): a message or internal message -> staffPostConversationMessage, a note ->
// staffPostNote. Shared documents carry a file, so they go through the route handler
// POST /staff/api/sites/<org>/document (Server Action body cap, P13-P20 pattern).
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import {
  CDS_NOTE_BODY_MAX,
  CDS_NOTE_TITLE_MAX,
  installAddonAsStaff,
  staffPostConversationMessage,
  staffPostNote,
  uninstallAddonAsStaff,
  type PlatformContext,
} from "@cds/db";
import { revalidatePath } from "next/cache";
import { addonDeps } from "../../../lib/addons";
import {
  errorName,
  runStaffAction,
  type ActionResult,
} from "../../../lib/staff-action";

type Failure = Extract<ActionResult<never>, { ok: false }>;

const ORG_RE = /^[a-z0-9]{15}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const REASON_MIN = 3;
const REASON_MAX = 500;
/** The addons:install feature key (STAFF_MATRIX: super_admin only). */
const FEATURE = "addon_install";

const SITE_NOT_FOUND: Failure = {
  ok: false,
  code: "not_found",
  message: "That site wasn't found.",
};
const ADDON_NOT_FOUND: Failure = {
  ok: false,
  code: "not_found",
  message: "That add-on wasn't found.",
};
const REASON_COPY = `Write a reason of ${REASON_MIN} to ${REASON_MAX} characters.`;

export type SiteAddonResult = {
  message: string;
  slug: string;
  outcome: string;
};

function own(raw: unknown, key: string): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return undefined;
  return Object.prototype.hasOwnProperty.call(raw, key)
    ? (raw as Record<string, unknown>)[key]
    : undefined;
}

type Parsed = { org: string; slug: string; name: string; reason: string };

function parse(orgId: unknown, input: unknown): Parsed | Failure {
  const org = typeof orgId === "string" && ORG_RE.test(orgId) ? orgId : null;
  if (!org) return SITE_NOT_FOUND;
  const slugRaw = own(input, "slug");
  const slug =
    typeof slugRaw === "string" && SLUG_RE.test(slugRaw) ? slugRaw : null;
  const manifest = slug ? ADDON_REGISTRY.get(slug) : undefined;
  if (!slug || !manifest) return ADDON_NOT_FOUND;
  const reasonRaw = own(input, "reason");
  const reason = typeof reasonRaw === "string" ? reasonRaw.trim() : "";
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
    return {
      ok: false,
      code: "invalid_input",
      message: REASON_COPY,
      field: "reason",
    };
  }
  return { org, slug: manifest.slug, name: manifest.name, reason };
}

function refresh(org: string): void {
  try {
    revalidatePath(`/staff/sites/${org}`);
  } catch (err) {
    console.error("[staff sites] revalidate failed", errorName(err));
  }
}

async function run(
  orgId: unknown,
  input: unknown,
  mode: "install" | "uninstall",
): Promise<ActionResult<SiteAddonResult>> {
  const p = parse(orgId, input);
  if ("ok" in p) return p;
  const result = await runStaffAction(
    FEATURE,
    { stepUp: true },
    async (ctx: PlatformContext) => {
      const call = { orgId: p.org, slug: p.slug, reason: p.reason };
      if (mode === "install") {
        const res = await installAddonAsStaff(ctx, addonDeps(), call);
        return {
          message: `${p.name} installed.`,
          slug: res.slug,
          outcome: String(res.outcome),
        };
      }
      const res = await uninstallAddonAsStaff(ctx, addonDeps(), call);
      return {
        message: `${p.name} uninstalled. Its content is kept.`,
        slug: res.slug,
        outcome: String(res.outcome),
      };
    },
  );
  if (result.ok) refresh(p.org);
  return result;
}

/** Install an add-on on one site (addons:install). `input` = `{ slug, reason }`. */
export async function installAddonAction(
  orgId: unknown,
  input: unknown,
): Promise<ActionResult<SiteAddonResult>> {
  return run(orgId, input, "install");
}

/** Remove an add-on from one site (addons:install --uninstall); data is kept. */
export async function uninstallAddonAction(
  orgId: unknown,
  input: unknown,
): Promise<ActionResult<SiteAddonResult>> {
  return run(orgId, input, "uninstall");
}

// ------------------------------------------------------------- post to site (13-43, cds:post)

/** The Server Action kinds; a document goes through the route handler (it carries a file). */
export type PostToSiteKind = "message" | "internal_message" | "note";
export type PostToSiteResult = { message: string; raised: number };

const POST_KINDS: readonly PostToSiteKind[] = [
  "message",
  "internal_message",
  "note",
];
/** The conversation message limit (@cds/db support/shared MESSAGE_BODY_MAX; not in the barrel). */
const MESSAGE_BODY_MAX = 5000;
/** cds:post result lines, verbatim. */
const INTERNAL_SAVED = "Saved as an internal note. The owner never sees it.";

function people(n: number): string {
  return `${n} ${n === 1 ? "person" : "people"}`;
}

/**
 * Post to one site, routed exactly like `cds:post`. `input` = `{ orgId, kind: "message" |
 * "internal_message" | "note", body, title? (note, 1-80), pinned? (note) }`. An internal
 * message alerts nobody; everything else alerts Owners, Admins and Editors.
 */
export async function postToSiteAction(
  input: unknown,
): Promise<ActionResult<PostToSiteResult>> {
  const orgRaw = own(input, "orgId");
  const org = typeof orgRaw === "string" && ORG_RE.test(orgRaw) ? orgRaw : null;
  if (!org) return SITE_NOT_FOUND;
  const kind = own(input, "kind");
  if (!(POST_KINDS as readonly unknown[]).includes(kind)) {
    return {
      ok: false,
      code: "invalid_input",
      message: "Pick Message, Note or Document.",
      field: "kind",
    };
  }
  const bodyRaw = own(input, "body");
  const body = typeof bodyRaw === "string" ? bodyRaw.trim() : "";
  const bodyMax = kind === "note" ? CDS_NOTE_BODY_MAX : MESSAGE_BODY_MAX;
  if (body === "" || body.length > bodyMax) {
    return {
      ok: false,
      code: "invalid_input",
      message: `Write the message (up to ${bodyMax.toLocaleString("en-US")} characters).`,
      field: "body",
    };
  }
  let title = "";
  if (kind === "note") {
    const t = own(input, "title");
    title = typeof t === "string" ? t.replace(/\s+/g, " ").trim() : "";
    if (title === "" || title.length > CDS_NOTE_TITLE_MAX) {
      return {
        ok: false,
        code: "invalid_input",
        message: `Give the note a title of up to ${CDS_NOTE_TITLE_MAX} characters.`,
        field: "title",
      };
    }
  }
  const pinned = kind === "note" && own(input, "pinned") === true;

  const result = await runStaffAction("cds_post", {}, async (ctx) => {
    if (kind === "note") {
      const r = await staffPostNote(ctx, { orgId: org, title, body, pinned });
      return {
        message: `Posted. Bell and email (logged) for ${people(r.raised)}.`,
        raised: r.raised,
      };
    }
    const internal = kind === "internal_message";
    const r = await staffPostConversationMessage(ctx, {
      orgId: org,
      body,
      internal,
    });
    return {
      message: internal
        ? INTERNAL_SAVED
        : `Posted. Bell and email (logged) for ${people(r.raised)}.`,
      raised: r.raised,
    };
  });
  if (result.ok) refresh(org);
  return result;
}

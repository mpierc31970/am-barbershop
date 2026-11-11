// Website › <add-on> tab loader (05-12; ADDON-08, ADDON-11..14; 05-UI-SPEC "Add-on tabs",
// "Training", "CSV import", "Backups"; T-05-58, T-05-62). Server component: loads the
// add-on's records (with the scan-held flag), its seeded page, the member's training for it
// and the existing groups through the chokepoint, binds the generic 05-12 actions to this
// (slug, collection), then renders the add-on's own admin Panel from the registry. The org
// comes only from the session cookie; the client Panel gets plain data and bound Server
// Actions, never @cds/db (invariants 1 and 4).
// 12-17 (COMM-11, D102; choice 4): the add-on's lock state (loadEditorLock, target the add-on)
// reaches the panel's AddonTabHeader through AddonTabLockContext (its `locked` prop default),
// which shows the LockedPanel; EditorLockFrame adds the HeldChangesPanel after the window and
// disables the panel while either applies. saveAddonRecordAction parks a locked save.
import { ADDON_REGISTRY, howToSteps } from "@cds/addon-registry";
import { addonPanel } from "@cds/addon-registry/admin";
import type { AddonManifest } from "@cds/core/addons";
import { NAV_TOP_MAX, navHasPage, navTopCount } from "@cds/core/content";
import { addonPageInfo, addonRepo, getNav, type AddonRecord } from "@cds/db";
import {
  InlineAlert,
  buttonClasses,
  type AddonPanelActions,
  type AddonPanelData,
  type AddonRecordView,
} from "@cds/ui/hub";
import Link from "next/link";
import {
  exportCsvAction,
  importCommitAction,
  importPreviewAction,
  listBackupsAction,
  removeAddonRecordAction,
  reorderAddonRecordsAction,
  restoreBackupAction,
  saveAddonRecordAction,
  saveBackupAction,
  setAddonRecordPublishedAction,
  templateCsvAction,
} from "../../../actions/addons";
import { addAddonPageToNavAction } from "../../../actions/site-chrome";
import { addonDeps } from "../../../../lib/addons";
import { requireHubSession, type HubSession } from "../../../../lib/session";
import { getTrainingFor } from "../../../../lib/training";
import { loadEditorLock } from "../../../../lib/editor-lock";
import { editorLockKey } from "../../../../lib/editor-lock-shared";
import { EditorLockFrame } from "./EditorLock";
import { tabHref } from "./tabs";

/** Stored fields the panel never needs (the org id and PocketBase bookkeeping). */
const HIDDEN_FIELDS: ReadonlySet<string> = new Set([
  "id",
  "organization",
  "created",
  "updated",
]);

function loadFailed(slug: string) {
  return (
    <InlineAlert
      tone="error"
      action={
        <Link href={tabHref(slug)} className={buttonClasses("secondary", "sm")}>
          Try again
        </Link>
      }
    >
      We couldn&apos;t load this. Check your connection and try again.
    </InlineAlert>
  );
}

export function recordView(r: AddonRecord, held: ReadonlySet<string>) {
  const values: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (!HIDDEN_FIELDS.has(k)) values[k] = v;
  }
  return { id: r.id, values, held: held.has(r.id) } satisfies AddonRecordView;
}

/** Distinct non-empty group values in list (sort_order) order. */
export function groupsOf(
  records: readonly AddonRecord[],
  field: string | undefined,
): string[] | undefined {
  if (!field) return undefined;
  const out: string[] = [];
  for (const r of records) {
    const v = r[field];
    if (typeof v === "string" && v.trim() !== "" && !out.includes(v.trim())) {
      out.push(v.trim());
    }
  }
  return out;
}

/** The add-on's list collection: the first record spec its manifest declares. */
function listCollection(m: AddonManifest): string | null {
  const [first] = Object.keys(m.records);
  return first && Object.hasOwn(m.collections, first) ? first : null;
}

function pageUrl(s: HubSession, slug: string): string | null {
  const host = s.org.primaryHost;
  return host ? `https://${host}/${encodeURIComponent(slug)}` : null;
}

/** Every panel operation, bound to this add-on and collection (T-05-58). */
export function boundActions(
  slug: string,
  collection: string,
): AddonPanelActions {
  return {
    save: saveAddonRecordAction.bind(null, slug, collection),
    setPublished: setAddonRecordPublishedAction.bind(null, slug, collection),
    reorder: reorderAddonRecordsAction.bind(null, slug, collection),
    remove: removeAddonRecordAction.bind(null, slug, collection),
    importPreview: importPreviewAction.bind(null, slug, collection),
    importCommit: importCommitAction.bind(null, slug, collection),
    exportCsv: exportCsvAction.bind(null, slug, collection),
    templateCsv: templateCsvAction.bind(null, slug, collection),
    listBackups: listBackupsAction.bind(null, slug),
    saveBackup: saveBackupAction.bind(null, slug),
    restoreBackup: restoreBackupAction.bind(null, slug),
    addToNav: addAddonPageToNavAction.bind(null, slug),
  };
}

export async function AddonPanel({ slug }: { slug: string }) {
  const session = await requireHubSession();
  const { ctx } = session;
  const manifest = ADDON_REGISTRY.get(slug);
  const Panel = addonPanel(slug);
  const collection = manifest ? listCollection(manifest) : null;
  if (!manifest || !Panel || !collection) {
    console.error("[hub] add-on tab has no panel", slug);
    return loadFailed(slug);
  }
  const spec = manifest.records[collection]!;

  let data: AddonPanelData;
  const lockRead = loadEditorLock(ctx, { kind: "addon", slug: manifest.slug });
  try {
    const repo = addonRepo(ctx, addonDeps(), manifest.slug).collection(
      collection,
    );
    const [records, holds, page, training, nav] = await Promise.all([
      repo.list(),
      repo.openHolds(),
      addonPageInfo(ctx, manifest.slug),
      getTrainingFor(ctx),
      // 07-25: the page line's Add to navigation; a failed read shows the plain control.
      Promise.resolve()
        .then(() => getNav(ctx))
        .catch(() => {
          console.error("[hub] add-on tab menu read failed");
          return null;
        }),
    ]);
    const held = new Set(holds);
    // Only an installed add-on's entry is in getTrainingFor(ctx) (ADDON-11, T-05-62).
    const ids = new Set(manifest.training.map((t) => t.id));
    const entry = training.find((t) => ids.has(t.id));
    const groups = groupsOf(records, spec.groupField);
    data = {
      slug: manifest.slug,
      name: manifest.name,
      singular: spec.singular,
      plural: spec.plural,
      collection,
      records: records.map((r) => recordView(r, held)),
      page:
        page && "id" in page
          ? {
              ...page,
              url: pageUrl(session, page.slug),
              inNav: navHasPage(nav, page.id),
              navFull: navTopCount(nav) >= NAV_TOP_MAX,
            }
          : page,
      trainingTitle: entry?.title ?? `How ${manifest.name} works`,
      trainingSteps: entry
        ? howToSteps(entry.howTo).map((st) => ({
            screen: st.screen,
            action: st.action,
            expected: st.expected,
          }))
        : [],
      csvEnabled: Boolean(
        manifest.csv && Object.hasOwn(manifest.csv, collection),
      ),
      ...(groups ? { groups } : {}),
    };
  } catch (err) {
    console.error("[hub] add-on tab load failed", slug, err);
    return loadFailed(slug);
  }

  const lock = await lockRead;
  return (
    <EditorLockFrame
      key={editorLockKey(lock)}
      state={lock}
      target="add-on"
      panelId={`addon-lock-${manifest.slug}`}
      addonHeader
    >
      <Panel data={data} actions={boundActions(manifest.slug, collection)} />
    </EditorLockFrame>
  );
}

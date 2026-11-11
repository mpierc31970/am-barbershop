// Demo barrel (13-10): flag (13-24), seed + reset (13-31). Explicit lists (review WR-A07):
// a new internal stays internal until it is listed here.
export { __clearDemoCacheForTests, orgIsDemo, setOrgDemoFlag } from "./flag";
// 15-07 (D209): the public demo link for the hub's live-demo panel.
export { readDemoSiteUrl } from "./public";
export {
  DEMO_NAME,
  DEMO_OWNER_EMAIL,
  DEMO_OWNER_NAME,
  DEMO_SLUG,
  DEMO_STAFF_NAME,
  demoDesign,
  type DemoOrg,
  type DemoSeedDeps,
  type DemoSeedResult,
  ensureDemoOrg,
  findDemoOrgId,
  seedDemoContent,
} from "./seed";
export {
  DEMO_LAST_RESET_KEY,
  DEMO_LOCK_KEY,
  DEMO_LOCK_STALE_MS,
  type DemoResetOptions,
  demoResetPreview,
  type DemoResetResult,
  DemoResetStepError,
  resetDemoOrg,
  staffResetDemo,
} from "./reset";

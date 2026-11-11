// 07-33: the every-block fixture for tests outside packages/db (the Phase 7 exit test).
// dev-seed-blocks is dev only and stays out of the @cds/db root (WR-A05); the invariant-1
// lint rule refuses relative imports of packages/db/src from apps/web, so tests reach it
// through this test-support re-export, as they reach the PocketBase harness.
export {
  BLOCKS_FIXTURE,
  BLOCKS_HOST,
  BLOCKS_NAME,
  BLOCKS_OWNER_EMAIL,
  seedBlocksTenant,
  type BlocksSeedResult,
} from "../src/dev-seed-blocks";

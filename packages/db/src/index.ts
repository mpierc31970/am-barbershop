// @cds/db public API (Invariant 1, TEN-02, D5). The only package that holds a PocketBase
// client, and it never hands one out: client.ts, the context minters and the asserts stay
// internal. Named exports only, so nothing leaks through a wildcard. The one exception is
// the P7 area barrels at the end (07-02): wired with `export *`, which is safe because each
// area barrel is itself named-exports-only and never exports a client, minter or helper.

export const packageName = "@cds/db";

export type { OrgContext, PlatformContext, SystemContext } from "./context";
export { tenantRepo, requirePermission } from "./repository";
export type {
  ListOptions,
  ReadRepo,
  WriteRepo,
  RecordData,
} from "./repository";
export { listAuditLog, AUDIT_LOG_RETENTION_DAYS } from "./audit";
export {
  signInStaff,
  completeStaffSignIn,
  platformContextFromToken,
  signInMember,
  orgContextFromToken,
  setStaffRole,
} from "./auth";
export type { StaffSignInStarted } from "./auth";
export {
  declinedMemberContext,
  forgetPushDeviceForSession,
  listMemberOrganizations,
} from "./auth";
export type { MemberOrganization, MemberOrganizations } from "./auth";
// Content chokepoint (CONT-01..12, CONT-30, CONT-31). flags.ts, lock.ts, shared.ts and
// screen.ts stay internal: no caller can write a screening flag or bypass the lock.
export {
  listPages,
  getPage,
  createPage,
  updatePage,
  SlugTaken,
  SlugReserved,
  RESERVED_SLUGS,
  SLUG_RE,
  NOT_FOUND_SLUG,
  NOT_FOUND_KIND,
} from "./content/pages";
export type { PageSummary } from "./content/pages";
// DASH-08 page allowance (11-26). countCountedPages / packsFor stay internal (superuser pb).
export { pageAllowanceFor, pagesUsage } from "./content/allowance";
// Page delete and Recently deleted (11-29; DASH-06, D275).
export {
  deletePage,
  restoreDeletedPage,
  listRecentlyDeleted,
  pageDeleteCase,
  PAGE_BIN_DAYS,
  PAGE_DELETE_COPY,
} from "./content/page-delete";
export type {
  DeletedPage,
  PageDeleteCase,
  PageDeleteDeps,
  PageDeleteLink,
} from "./content/page-delete";
export {
  listSections,
  saveSection,
  reorderSections,
  setSectionHidden,
  deleteSection,
  undoDeleteSection,
  addonOffBlockCopy,
  registerSectionAddonOwners,
} from "./content/sections";
export type {
  SectionRow,
  DeletedSection,
  SaveSectionInput,
  SectionAddonOwners,
} from "./content/sections";
export {
  listPopups,
  getPopup,
  savePopup,
  setPopupEnabled,
  deletePopup,
  popupUsage,
  type PopupWithState,
  type PopupUsage,
} from "./content/popups";
export { deletedRefsAmong, type DeleteOutcome } from "./content/soft-delete";
export { getBanner, saveBanner } from "./content/site-settings";
// Publish, versions and restore (CONT-30, D184, D254) and the builder preview (CONT-08).
export {
  publishPage,
  restorePageVersion,
  listPageVersions,
} from "./content/publish";
export type {
  PublishDeps,
  PublishResult,
  PageVersion,
  PageVersionAuthor,
} from "./content/publish";
export { previewPage } from "./content/project";
// Visitor reads (invariant 1, D187, D253, CONTEXT A3-Q1). The SiteContext minter and
// assert stay internal: only the host resolver below hands one out.
export {
  siteContextForHost,
  readSiteManifest,
  readPublishedPage,
  readPublicSiteSettings,
  readPublicPopups,
  readPublicBusiness,
  readPublicAnalytics,
  projectPublicBusiness,
} from "./content/site-context";
export type {
  SiteContext,
  PublicAnalytics,
  PublicBusiness,
  PublicSiteSettings,
} from "./content/site-context";
export {
  siteTag,
  pageTag,
  liveTag,
  addonsTag,
  addonTag,
  recordingInvalidator,
} from "./content/ports";
export type {
  ContentScanner,
  SearchPinger,
  Invalidator,
  ContentDeps,
  ScanInput,
  ScanResult,
  ScanVerdict,
} from "./content/ports";
export {
  getContentScanner,
  getSearchPinger,
  keywordScanner,
  loggingPinger,
} from "./content/scan-standin";
export {
  addMember,
  changeRole,
  setAddonGrants,
  removeMember,
  transferOwnership,
} from "./members";
export type { AddMemberInput } from "./members";
export {
  startImpersonation,
  startImpersonationSession,
  resumeImpersonation,
  endImpersonation,
  IMPERSONATION_SESSION_MS,
} from "./impersonation";
// Theme chokepoint (THEME-01..03, D44-D46): staff-only audited write, visitor and owner reads.
export {
  setOrganizationDesign,
  readPublicDesign,
  readOrganizationDesign,
  themeTag,
  ThemeWriteFailed,
} from "./theme";
export type { ThemeDeps, ThemeWriteResult } from "./theme";
export type { ImpersonationView, ImpersonationSession } from "./impersonation";
export {
  TENANT_COLLECTIONS,
  ORGANIZATION_EXPORT_FIELDS,
  ORGANIZATION_PUBLIC_FIELDS,
  composeTenantCollections,
  registerAddonCollections,
  allTenantCollections,
  addonCollectionsRegistered,
  getCollectionSpec,
} from "./registry";
// Add-on chokepoint (ADDON-04..07, ADDON-09; CONTEXT A2). entitlements' row readers,
// records.ts and the staff context minter stay internal.
export { standInBillingGate, getBillingGate } from "./addons/billing";
export type { BillingGate, BillingApproval } from "./addons/billing";
export {
  listOrgAddons,
  activeAddons,
  pausedAddons,
  recentAddonInstalls,
  addonPageInfo,
} from "./addons/entitlements";
export {
  installAddon,
  uninstallAddon,
  installAddonAsStaff,
  uninstallAddonAsStaff,
  retainedRecordCounts,
} from "./addons/installer";
// P8 assembly (08-16; TMPL-02..04): the staff entry point, version keys for DASH-07, the
// ledger parser and report text. The system run and its context minting stay internal
// (08-17 adds the queue and sweep).
export {
  assembleSiteAsStaff,
  assemblyVersionKeys,
  getCopyWriter,
  parseLedger,
  DRY_RUN_FIRST_LINE,
  polishCount,
  polishLines,
  polishSummaryLine,
  // 11-17: Today reads the assembly status for the build tracker (business:read).
  readLedger,
  reportRows,
  rerunLines,
  summaryLine,
  wouldAssembleLine,
  // 11-37: Marketing › Social shows BIO-PREVIEW while the site is on its preview host.
  previewHostSuffix,
} from "./assembly";
export type {
  AssemblyResult,
  AssemblyReport,
  AssemblyLedger,
  AssemblyRunDeps,
} from "./assembly";
export { addonRepo } from "./addons/addon-repo";
export type { AddonRepo, AddonCollectionRepo } from "./addons/addon-repo";
export {
  readAddonSiteState,
  readPublicAddonRecords,
} from "./addons/site-state";
export type { AddonSiteState } from "./addons/site-state";
// Shared CSV import/export and JSON backups for list add-ons (ADDON-12..14, D125, D126).
export {
  previewAddonImport,
  importAddonRecords,
  exportAddonCsv,
  addonCsvTemplate,
  MAX_IMPORT_CHARS,
  REMOVALS_CHANGED_COPY,
} from "./addons/import";
export {
  listAddonBackups,
  saveAddonBackup,
  restoreAddonBackup,
  ADDON_BACKUP_FORMAT,
  ADDON_BACKUP_VERSION,
  ADDON_BACKUPS_KEPT,
} from "./addons/backups";
export type { AddonBackupReason, AddonBackupSummary } from "./addons/backups";
export type {
  AddonRecord,
  AddonDeps,
  InstallSource,
  OrgAddonRow,
  InstallOptions,
  InstallResult,
  UninstallResult,
} from "./addons/types";
// Price catalog (ONB-06, CONTEXT A2-Q2): public read, audited super_admin write.
export {
  readPriceCatalog,
  setPrice,
  readCatalogBillingRefs,
  syncAllPrices,
  pendingPriceSyncs,
  priceCase,
} from "./catalog";
export type {
  SetPriceInput,
  CatalogDeps,
  CatalogBillingRef,
  PendingPriceSync,
  PriceCase,
} from "./catalog";
export { resolveOrganization, clearResolverCache } from "./resolve";
export type { ResolvedOrg } from "./resolve";
export type { CollectionSpec } from "./registry";
export {
  getObjectStore,
  getAgreementStore,
  tenantAgreementKey,
  tenantAgreementPrefix,
  assertValidKey,
  envPrefix,
  platformDbPrefix,
  tenantAddonBackupKey,
  tenantAddonBackupPrefix,
  tenantExportKey,
  tenantExportPrefix,
  tenantPublishedPageKey,
  tenantSiteManifestKey,
  tenantVersionKey,
  tenantVersionPrefix,
} from "./storage";
export type {
  ObjectStore,
  StoredObject,
  MediaObjectName,
  WriteOnceObjectStore,
} from "./storage";
export { devMailKey, tenantMediaKey } from "./storage";
// Email pipeline (EMAIL-01, ONB-10; 06-06): the one send path, suppression list, signed links.
export {
  sendEmail,
  emailSendFailures,
  EmailSendFailed,
  canSend,
  addSuppression,
  isSuppressed,
  captureTransport,
  loggingTransport,
  getEmailTransport,
  signLink,
  verifyLink,
  linkSecret,
  platformUrl,
  mailDomain,
  supportEmail,
  renderEmail,
} from "./email";
export type {
  SendResult,
  SendDeps,
  SendAs,
  SuppressionReason,
  SuppressionScope,
  EmailTransport,
  RenderedEmail,
  EmailData,
} from "./email";
export { toSnapshot, fromSnapshotRecord, SnapshotForbidden } from "./snapshot";
export {
  exportTenant,
  restoreTenant,
  runNightlyExports,
  EXPORT_RETENTION_DAYS,
} from "./export";
// Org closure (LIFE-02, D283, invariant 9; 09-12): the one way to close an org.
export { markOrgClosed, reopenOrg, CLOSED_REASONS } from "./org-closure";
export type { ClosedReason } from "./org-closure";
// bootstrapDevTenant (dev-seed.ts) is DEV ONLY and deliberately NOT exported here (WR-A05):
// the seed script imports it by relative path, so no app code can reach it.
export type {
  TenantBundle,
  ExportResult,
  NightlyResult,
  RestoreOptions,
  RestoreResult,
  RestoreSkip,
} from "./export";
// Anonymous quote chokepoint (ONB-08, D213; 06-07): raw token + IP in, never an org id.
export {
  createQuote,
  readQuoteByToken,
  updateQuote,
  saveQuoteEmail,
  quoteLinkState,
  quoteReopenLink,
  quoteUnsubscribeLink,
  quoteUnsubscribePostUrl,
  describeUnsubscribe,
  unsubscribeQuote,
  quoteSignedReopenLink,
  resolveSignedReopen,
  describeSignedReopen,
  QUOTE_TOKEN_RE,
  QUOTE_TTL_DAYS,
  QUOTE_UNSUB_GRACE_DAYS,
  ERR_HUMAN,
} from "./quotes";
export type { QuoteStatus, QuoteView, QuoteDeps, QuotePatch } from "./quotes";
// Hourly quote job (ONB-08, D213, D290; 06-09) and its platform_meta heartbeat reader.
// writePlatformMeta stays internal: only a job writes a heartbeat.
export { runQuoteJobs } from "./jobs/quotes";
export { runMediaJobs } from "./jobs/media";
// Retention job (LIFE-02, D283, D290; 09-12). Monitor brief check 26 documents the keys.
export {
  runRetentionJob,
  retentionStatus,
  RETENTION_HEARTBEAT_KEY,
  RETENTION_COUNTS_KEY,
} from "./jobs/retention";
export type {
  RetentionJobResult,
  RetentionJobOptions,
  RetentionJobDeps,
  RetentionStatusReport,
} from "./jobs/retention";
// Billing reconcile job (PAY-01, PAY-02, PAY-03, D244; 10-21). Monitor brief check 27
// documents the keys and billingStatus().
export {
  runBillingJob,
  billingStatus,
  billingCounts,
  parseBillingSince,
  BILLING_HEARTBEAT_KEY,
  BILLING_COUNTS_KEY,
} from "./jobs/billing";
export type {
  BillingJobResult,
  BillingJobOptions,
  BillingJobDeps,
  BillingStatusReport,
} from "./jobs/billing";
// P8 (08-17): Send-to-CDS enqueue and the hourly assembly sweep + monitor status.
export { enqueueAssembly } from "./assembly/queue";
export {
  runAssemblyJobs,
  assemblyStatus,
  ASSEMBLY_HEARTBEAT_KEY,
  ASSEMBLY_COUNTS_KEY,
  type AssemblyJobResult,
  type AssemblyStatusReport,
} from "./jobs/assembly";
export type { MediaJobResult, MediaJobOptions } from "./jobs/media";
export type { QuoteJobResult, QuoteJobOptions } from "./jobs/quotes";
export { readPlatformMeta } from "./platform-meta";
// HumanCheck port (PD-14): Turnstile siteverify; test checkers for callers' tests.
export {
  turnstileHumanCheck,
  alwaysPass,
  alwaysFail,
  getHumanCheck,
} from "./human-check";
export type { HumanCheck } from "./human-check";
export {
  beginQuoteAction,
  resetQuoteLimitsForTests,
  QUOTE_CREATE_PER_IP,
  QUOTE_UPDATE_PER_IP,
  QUOTE_SAVE_PER_IP,
  QUOTE_RATE_COPY,
} from "./rate-limit";
export {
  SUBMIT_PER_IP,
  SUBMIT_PER_EMAIL,
  SUBMIT_RATE_COPY,
  resetSubmitLimitsForTests,
  CONFIRM_SENDS_PER_ORG,
  CONFIRM_SENDS_PER_ADDRESS,
  CONFIRM_RATE_COPY,
  resetConfirmSendLimitsForTests,
} from "./rate-limit";
// Public /report limiter (13-30, P13-P24).
export {
  beginReportAction,
  resetReportLimitsForTests,
  REPORT_PER_IP,
  REPORT_RATE_COPY,
} from "./rate-limit";
// Hub /contact limiter (15-03; A3-Q2).
export {
  beginContactAction,
  resetContactLimitsForTests,
  CONTACT_PER_IP,
  CONTACT_RATE_COPY,
} from "./rate-limit";
// Edge ask limiter (14-17; DOM-06).
export {
  beginEdgeAskMiss,
  resetEdgeAskLimitsForTests,
  EDGE_ASK_MISSES_PER_DOMAIN,
} from "./rate-limit";
// Fit check + staff fit review (ONB-12, D215; PD-23; 06-08).
export {
  keywordFitChecker,
  getFitChecker,
  describeFitCase,
  approveFit,
  declineFit,
  FIT_CASE_CHANGED_COPY,
  FIT_BLOCKED_COPY,
  FIT_DECLINE_PAID_COPY,
  fitDeclineNeedsRefund,
} from "./fit";
export type {
  ApproveFitDeps,
  FitChecker,
  FitInput,
  FitResult,
  FitVerdict,
  FitCase,
} from "./fit";
// Submit and member code sign-in (ONB-08, ONB-01; D213, D286; 06-08).
export {
  startSubmit,
  completeSubmit,
  requestMemberCode,
  completeMemberCode,
  SubmitCodeInvalid,
  SubmitCodeExpired,
  SubmitFailed,
  ERR_CODE,
  ERR_CODE_EXPIRED,
  ERR_CREATE,
  SUBMIT_SUPPRESSED_COPY,
} from "./signup";
export type { SubmitStartInput, SubmitOutcome, SubmitDeps } from "./signup";
export {
  BUILD_NOTE_MAX,
  getOrgStage,
  getSitePreviewUrl,
  LAUNCH_REVIEW_ITEMS,
  launchReviewProgress,
  orgIsLive,
  readOrgStatus,
  setBuildNote,
  setOrgStage,
  staffOrgStage,
} from "./org-stage";
export type {
  LaunchReviewProgress,
  OrgAnalytics,
  OrgStage,
  OrgStatus,
  StaffOrgStage,
} from "./org-stage";
// Staff leads list: saved quotes + orgs still in setup (ONB-07, PD-7; 06-10).
export { listLeads } from "./leads";
// 15-07 (A3-Q2): hub inquiries are leads (kind "inquiry"); staff topic words.
export { INQUIRY_TOPIC_LABELS, inquiryStatus } from "./leads";
export type { Lead, ListLeadsOptions } from "./leads";
// Hub /contact inquiries: platform collection, staff list (15-03; HUB-07, P15-P14).
// pruneHubInquiries is context-free and stays internal: jobs/retention.ts imports it by
// relative path (WR-B07, Invariant 1).
export {
  createHubInquiry,
  listHubInquiries,
  validateHubInquiry,
  HUB_INQUIRY_TOPICS,
  HUB_INQUIRY_RETENTION_DAYS,
  HUB_INQUIRY_LIMITS,
} from "./hub-inquiries";
export type {
  HubInquiryInput,
  HubInquiryTopic,
  HubInquiryRow,
  HubInquiryDeps,
} from "./hub-inquiries";
// Intake chokepoint (ONB-01, ONB-02, ONB-13; D257; 06-11): business profile, intake state,
// team and services. OrgContext first, business feature; nothing takes an org id.
export {
  getBusinessProfile,
  saveBusinessProfile,
  readAlertProfileFacts,
  setSensitivePractice,
  SENSITIVE_PRACTICE_AUDIT,
  getOrgIntake,
  markStageSaved,
  saveIntakeAnswers,
  dismissFirstVisit,
  listTeam,
  saveTeamMember,
  removeTeamMember,
  reorderTeam,
  listServices,
  saveService,
  deleteService,
  reorderServices,
  previewCoreImport,
  commitCoreImport,
  exportCoreCsv,
  coreCsvTemplate,
  PHOTO_COPY,
  REORDER_COPY,
  // 06-12: email routing (ONB-09, ONB-10, D173)
  listEmailRoutes,
  addEmailRoute,
  changeDefaultRoute,
  resendRouteConfirmation,
  removeEmailRoute,
  setNewsletterSender,
  describeRouteConfirm,
  confirmEmailRoute,
  recordBounce,
  ROUTE_COPY,
  // 06-12: add-on intake, snapshot, P8 assembly contract, Send to CDS
  saveAddonIntakeFields,
  previewAddonIntakeImport,
  commitAddonIntakeImport,
  saveAddonIntakeRecord,
  removeAddonIntakeRecord,
  ADDON_INTAKE_COPY,
  getIntakeSnapshot,
  getIntakeForAssembly,
  sendToCds,
  IntakeIncomplete,
  INTAKE_INCOMPLETE_COPY,
} from "./intake";
export type {
  AlertProfileFacts,
  SensitivePracticeSetting,
  EmailRoute,
  AddonIntakeImportMode,
  AssembledValue,
  AssemblyIntake,
  BusinessProfile,
  OrgIntake,
  AddonIntakeConfig,
  TeamMember,
  SavedTeamMember,
  Service,
  SavedService,
  CoreListKind,
  CoreImportMode,
} from "./intake";
// Media chokepoint (ONB-04, ONB-05; 06-13): uploads through sharp into the ObjectStore,
// private reads, alt text, remove / restore, reorder; the mood board proposal goes to
// org_intake only (D47).
export {
  uploadImage,
  readMediaVariant,
  listMedia,
  setMediaAlt,
  removeMedia,
  restoreMedia,
  reorderMedia,
  isMediaKind,
  isMediaVariant,
  MEDIA_KINDS,
  MEDIA_VARIANTS,
  MEDIA_LIMITS,
  ALT_MAX,
  ALT_COPY,
  UploadRejected,
  UPLOAD_COPY,
  MAX_UPLOAD_BYTES,
  MAX_INPUT_PIXELS,
} from "./media";
export type {
  MediaAsset,
  MediaKind,
  MediaVariant,
  UploadRejectReason,
} from "./media";

// P7 seams (07-02): one area barrel per owning plan, plus the port contracts.
export * from "./media/store";
export * from "./media/cdn";
export * from "./media/library";
export * from "./media/video";
export * from "./media/ops";
export * from "./forms";
export * from "./contacts";
export * from "./content/chrome";
export * from "./content/history";
export * from "./content/seo";
export * from "./content/site-index";
export * from "./content/protected";
export type {
  PublicMediaKind,
  PublicMediaVariant,
  DeliveryAssetRef,
  MediaUrlOptions,
  MediaDelivery,
  VideoProbe,
  TranscodeJob,
  TranscodeResult,
  FrameJob,
  VideoTranscoder,
} from "./media/ports";
export type { FileScanVerdict, FileScanner } from "./forms/scanner-port";
export type {
  MapQuery,
  MapEmbed,
  StockPhoto,
  StockPhotoPage,
  StockPhotoSource,
} from "./content/p7-ports";
// MapEmbed adapter (07-24): keyless stand-in, Maps Embed API when GOOGLE_MAPS_EMBED_KEY is set.
export { createMapEmbed, getMapEmbed } from "./content/map-embed";
export type { MapEmbedAdapter } from "./content/map-embed";
// P9 legal (09-08): policy_versions sync, active lookups, sha256.
export * from "./legal";
// P10 payments (10-02, PAY-09): one barrel; the Stripe adapter stays internal.
export * from "./payments";
// P11 (11-01): one barrel per area; owner plans fill the modules.
export * from "./today";
export * from "./alerts";
export * from "./reports";
export * from "./social";
export * from "./people";
export * from "./downloads";
// P12 (12-01): support barrel and the support job seam; owner plans fill the modules.
export * from "./support";
export * from "./jobs/support";
// Staff CLI labels (12-30): exported for the console (13-10, RESEARCH Pitfall 3).
export { staffSupportLabels } from "./support/staff-labels";
export type { StaffSupportLabels } from "./support/staff-labels";
// P13 (13-10): staff console seams; owner plans fill the modules, never these lines.
export * from "./staff";
export * from "./demo";
// 15-07 (HUB-01, D209): public demo link reader (also in the demo barrel above; named here so
// the hub's reader is easy to find).
export { readDemoSiteUrl } from "./demo";
export * from "./content/scan";
export * from "./jobs/review";
export * from "./jobs/health";
export * from "./jobs/indexing";
export * from "./jobs/demo";
// P14 (14-02 seams; owners in 14-EXECUTOR-BRIEF)
export * from "./dns";
export * from "./email/sending-domains";
export * from "./content/indexnow";
export * from "./content/sitemap-submit";
export * from "./launch-review";
export * from "./offboarding";
export * from "./jobs/domains";

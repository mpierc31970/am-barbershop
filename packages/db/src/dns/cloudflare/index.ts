// packages/db/src/dns/cloudflare/index.ts (P14, DOM-03; 14-11).
// Owner: 14-11. Cloudflare adapter entry point. Only ../factory.ts imports this folder; the dns
// barrel never re-exports it (payments/stripe precedent). Env is read by the factory, never here.
export {
  cloudflareDnsProvider,
  platformImportLock,
  CF_IMPORT_LOCK_KEY,
  CF_IMPORT_SPACING_MS,
  type CloudflareDnsProviderOptions,
  type CfImportLock,
} from "./provider";
export { CloudflareError, CLOUDFLARE_API_BASE } from "./client";

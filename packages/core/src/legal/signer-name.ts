// The one typed-signature normaliser (WR-B04). The hub's live signing statement and
// validation (@cds/ui) and signAgreement (@cds/db) both use it, so what the signer sees is
// exactly what is recorded and printed on the signed copy. Pure, no imports: client-safe
// (imported through the "@cds/core/legal/signer-name" subpath to keep client bundles small).

export const SIGNER_NAME_MIN = 2;
export const SIGNER_NAME_MAX = 120;

/**
 * NFC; control, format (zero-width, bidi, soft hyphen, tags), line and paragraph separator
 * characters become spaces; whitespace runs collapse to one space; trimmed.
 */
export function normalizeSignerName(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 2-120 code points after normalizeSignerName. */
export function signerNameValid(raw: string): boolean {
  const len = [...normalizeSignerName(raw)].length;
  return len >= SIGNER_NAME_MIN && len <= SIGNER_NAME_MAX;
}

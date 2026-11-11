// "./server": Builder Pro owns no block, so it reads no records and returns no block data.
// Present only because addons:gen imports every add-on's server entry (10-07).
export const blockCollections = [] as const;

export function blockData(): Record<string, never> {
  return {};
}

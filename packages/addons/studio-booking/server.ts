// "./server": Studio Booking owns no page block (its public pages are /barbers and /book,
// rendered by the tenant routes through @cds/db), so it reads no block records.
export const blockCollections = [] as const;

export function blockData(): Record<string, never> {
  return {};
}

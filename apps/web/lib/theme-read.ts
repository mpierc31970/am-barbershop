// The theme is decoration (WR-04, THEME-02): a failed theme read (timeout, 5xx) must never
// take down a tenant page or a hub tab whose own data loaded fine. It is logged and the
// caller renders the neutral preset (resolveTheme(null)).

/** `read`, or null (the neutral preset) when it fails. The failure is logged, never thrown. */
export async function themeOrNeutral<T>(
  read: Promise<T | null>,
  where: string,
): Promise<T | null> {
  try {
    return (await read) ?? null;
  } catch (err) {
    console.error(`[${where}] theme read failed`, err);
    return null;
  }
}

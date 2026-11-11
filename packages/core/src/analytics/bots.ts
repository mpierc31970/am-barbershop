// Bot filter for the first-party beacon (11-06; DASH-11). Lighthouse runs and headless
// browsers must not count as visitors, so "lighthouse" and "headless" are in the pattern.
// An empty or missing user agent is treated as a bot.

const BOT_RE =
  /bot|crawl|spider|slurp|headless|lighthouse|preview|fetch|monitor|curl|wget|python|axios/i;

export function isBot(ua: string | null | undefined): boolean {
  if (typeof ua !== "string" || ua.trim() === "") return true;
  return BOT_RE.test(ua);
}

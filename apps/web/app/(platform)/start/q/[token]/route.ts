// GET /start/q/<token> (ONB-08; 06-UI-SPEC "Quote links"; RESEARCH Pitfall 3; T-06-78).
// The "saved quote" email's link. A Route Handler, not a page, because it sets the quote
// cookie. Valid -> cookie + 302 /start?welcome=1 (every choice restored from the quote);
// submitted -> the "already submitted" page; expired, invalid, malformed and unknown all
// go to the same expired page, so a token cannot be probed. A malformed segment never
// reaches the database. no-store + no-referrer: the token is in the URL.
import { QUOTE_TOKEN_RE, quoteLinkState } from "@cds/db";
import { reopenResponse } from "../../../../../lib/quote-links";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  if (typeof token !== "string" || !QUOTE_TOKEN_RE.test(token)) {
    return reopenResponse({ state: "expired" });
  }
  let state: "valid" | "expired" | "submitted";
  try {
    state = await quoteLinkState(token);
  } catch (err) {
    // The token is never logged.
    console.error(
      `[quote-links] reopen lookup failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    state = "expired";
  }
  return reopenResponse(state === "valid" ? { state, token } : { state });
}

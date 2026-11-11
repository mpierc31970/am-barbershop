---
feature: Competitor claims on the hub
phase: 15
route: /staff/health (terminal: npm run hub:claims)
---

# How to: Competitor claims on the hub

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Every competitor figure on the hub (the comparison table, its footnotes, the sources table and the cost calculator on `/pricing`, `/standard` and `/studio`) comes from one file: `packages/core/src/marketing/claims.ts` (HUB-06). Each claim has an `id`, the `competitor`, the `figure`, a `sourceUrl` and `sourceTitle`, `verifiedOn` (the day the figure was last read at the source, `YYYY-MM-DD`) and a `status` of `draft` or `verified`.

- **Drafts never show in production** (A2-Q4). In dev and preview they show with a **Draft** badge. With no verified claim, the comparison is hidden in production.
- **Re-check every 6 months.** Health check 51 (`hub-claims`, "Hub competitor claims") watches the oldest verified claim: **warning** over 150 days, **critical** over 183 days. With no verified claim it stays ok. Staff are emailed once per incident.
- `npm run hub:claims` is read-only: no sign-in, no database, nothing written.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Terminal at the repo root | Run `npm run hub:claims -- --help` | The usage text prints, starting "hub:claims - read-only table of the hub's competitor claims (HUB-06)" and ending "Nothing is written anywhere." |
| 2 | Same terminal | Run `npm run hub:claims` | A table `id · competitor · verified on · age (days) · status` (for example `mindbody-online  Mindbody  2026-09-24  24  draft`), then "9 claims · 0 verified · 9 draft · oldest verified none" and "Read-only: nothing was written." Add `--json` for the same rows as JSON |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `npm run hub:claims` output | Pick the claim with the largest **age (days)**, or every `draft` before launch | You have the claim `id` to re-check |
| 2 | `packages/core/src/marketing/claims.ts` | Find the claim by `id` and open its `sourceUrl` in a browser | The competitor's own pricing page opens (for example "Mindbody pricing") |
| 3 | The source page | Compare the published figure with the claim's `figure` and `text` (for example "3.60% + 30¢ online") | Either it still matches, or you note the new figure |
| 4 | `claims.ts` | If it matches: set `status: "verified"` and `verifiedOn` to today (`YYYY-MM-DD`). If it changed: update `figure`, `text` and any `rate` / `share` / `monthlyCents` numbers too, then set `status` and `verifiedOn`. If the source is gone: leave it `draft` | Only figures read at the source that day are marked verified |
| 5 | Terminal | Run `npm test` and `npm run lint`, commit `claims.ts`, push | Tests stay green; after the deploy the verified claim renders in production with its footnote and source row |
| 6 | Terminal | Run `npm run hub:claims` again | The claim reads `verified` with age `0`, and the footer counts it ("… 1 verified · 8 draft · oldest verified 0 days") |
| 7 | `/staff/health` (Platform) | Read the **Hub competitor claims** row | ok while every verified claim is 150 days old or less. Over 150 days it turns warning ("a competitor claim on the hub was last checked over 5 months ago (150 days): re-check it, see docs/how-to/staff-hub-claims.md"), over 183 critical; staff get one email per incident. The monitor app reads the same numbers from `GET /api/monitor/status` (`hub.claims_verified`, `hub.claims_draft`, `hub.oldest_verified_days`) |
| 8 | Same row after the re-check | Repeat steps 2 to 5 for the oldest claim, then refresh health | The row returns to ok and the incident closes with a "resolved" email |

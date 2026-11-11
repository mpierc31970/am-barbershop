---
feature: Verify a signed agreement (staff)
phase: 09
route: npm run agreements:verify
---

# How to: Verify a signed agreement (staff)

Operator feature with no screen. It runs in a terminal at the repo root.

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

`agreements:verify` proves, years later, that a site's signed agreements are exactly what was signed (AGR-01, AGR-04, AGR-05). For every signing of one site it recomputes the **evidence** hash (the signing record) and the **document** hash (the signed copy the owner got), checks the evidence still agrees with the database record, checks every policy text it cites still hashes the same, and checks the audit record carries the same hashes. It reads only; each run writes one `agreement.verify` audit row. Super admin or support agent.

Policy codes in the output: **SA** Service Agreement · **AUP** Acceptable Use · **TOS** Terms of Service · **SUB** Subscription terms · **DPA** Data Processing Agreement · **ESC** e-sign consent. The number after a code is the version (`TOS2` is Terms of Service version 2).

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | PB admin UI `https://api.cds.needtobeedgy.com/_/` (production: `https://pb.connectionsdesignstudios.com/_/`), collection **users** | Make sure your record has **staff_role** `super_admin` or `support_agent` | You can sign in to the tool |
| 2 | Repo root, file `.env.local` | Make sure it has `PB_URL`, `PB_SUPERUSER_EMAIL`, `PB_SUPERUSER_PASSWORD` and `PB_APP_KEY` for the target PocketBase, plus the agreement store settings the app uses | The tool can reach the database and the stored copies. A missing value stops with `FAIL PB_URL is not set` (or the name of the missing value) |
| 3 | Terminal at the repo root | Run `npm run agreements:verify -- --help` | The usage prints, ending with the policy-code legend line `Policy codes: SA Service Agreement · ... · ESC e-sign consent`. Nothing is signed in or read |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | PB admin UI `/_/`, collection **organizations** | Find the site and copy its id | You have the 15-character org id |
| 2 | Terminal at the repo root | Run `npm run agreements:verify -- --org <org-id>` | The tool asks for **Staff email** |
| 3 | Same terminal | Type your staff email, press Enter, type the password (not shown), press Enter | `Sign-in OTP sent to the staff email. Enter it below.` In dev with `CDS_OTP_STANDIN=1` the 6-digit code is in the PocketBase log line `OTP_STANDIN users <user-id> <otp-id> <code>` |
| 4 | Same terminal | Type the 6-digit code and press Enter | `PASS signed in`, then a header such as `Rivera Bakery · org abc123def456ghi · 2 signings` and a table with columns `SIGNED (UTC)  SIGNER  KIND  POLICIES  IP  EVIDENCE  DOCUMENT`, oldest signing first |
| 5 | Same terminal | Read each row | A genuine signing shows `MATCH` under both **EVIDENCE** and **DOCUMENT**. The last line reads `All 2 signings verified.` and the tool exits 0 |
| 6 | Same terminal | If a cell reads `MISMATCH` or `missing` | Under the table one line per problem, for example `2026-10-08 signing: document hash differs (stored 9f2c…, computed 41ab…).`, then `1 of 2 signings failed. Don't change anything; tell the CDS owner.` and exit 1. Do not edit, re-upload or delete anything: copy the output and send it to the CDS owner |
| 7 | Same terminal | Run it for a site that never signed | `No signings recorded for this org.` (exit 0) |
| 8 | Same terminal | Run it with a wrong org id, or sign in with an account that is not CDS staff | `Org <id> not found, or this account isn't CDS staff.` (exit 1) |
| 9 | PB admin UI `/_/`, collection **audit_log** | Filter `action = "agreement.verify"` | One row per run with you as actor, the site's organization, and `signings` and `failures` in `meta` |

What a MISMATCH means: the stored copy, its evidence record, a policy text it cites or its audit record has changed since the signing. Signed records are append-only and the copies are write-once, so this points at tampering or storage damage; the CDS owner decides what happens next.

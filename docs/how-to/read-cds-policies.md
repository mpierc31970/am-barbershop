---
feature: Read CDS policies (public)
phase: 09
route: /legal/<key>
---

# How to: Read CDS policies (public)

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

CDS publishes its five policies on the platform site so anyone can read them before signing up, without an account: **Service Agreement** (`/legal/service-agreement`), **Acceptable Use Policy** (`/legal/acceptable-use`), **Terms of Service** (`/legal/terms-of-service`), **Subscription terms** (`/legal/subscription-terms`) and **Data Processing Agreement** (`/legal/dpa`). Every version ever published stays readable at `/legal/<key>/v<N>`, so anyone can check exactly what an owner signed.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/legal/terms-of-service` | Nothing to switch on: open the address in any browser, signed in or not | The five pages ship with the platform. While the texts are drafts (until the lawyer review listed in GO-LIVE), each page shows the yellow alert "Draft: this text hasn't been reviewed by a lawyer yet and will change before CDS launches." |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/start`, footer | Scroll to the bottom and click **Terms of Service** in the row of five policy links | `/legal/terms-of-service` opens: the top bar with **Connections Design Studios** and **Sign in**, the heading **Terms of Service**, the grey line "Version 1 · Effective 8 Oct 2026", the yellow DRAFT alert, the **In short** box with three bullets, then the full text. The browser tab reads "Terms of Service · Connections Design Studios" |
| 2 | `/start`, **Can my site be hosted here?** | Open the box and click **Read the Acceptable Use Policy** under the two lists | `/legal/acceptable-use` opens with the headed lists **Sites we don't host** and **Sites we review first** in the full text |
| 3 | `/legal/acceptable-use`, **Policies** list (right side on a wide screen, under the text on a phone or tablet) | Click **Data Processing Agreement** | `/legal/dpa` opens; in the list, **Data Processing Agreement** is now the bold current item and the others are links |
| 4 | `/legal/terms-of-service`, **Earlier versions** (shown under the Policies list once a policy has a second version) | Click **Version 1 · until {date}**, or type `/legal/terms-of-service/v1` | Version 1 opens with a grey info alert "This is version 1. It was replaced on {date}." and the link **Read the current version**, which goes back to `/legal/terms-of-service`. Past versions are hidden from search engines; current ones are not |
| 5 | `/legal/not-a-policy` or `/legal/dpa/v9` | Type the address | The not-found page in the same frame: "We can't find that page" with a link to the Terms of Service |

## Note for CDS staff

- The text comes from `packages/core/src/legal/policies/<key>/v<N>.md`, compiled into the app; the pages never read the database, so they stay up even if PocketBase is down.
- To publish a change, add a new version file (`v2.md`, with what changed) and run `npm run legal:gen`. Never edit a version someone has signed: the app's policy sync compares each version's hash with the stored copy and refuses a changed text.

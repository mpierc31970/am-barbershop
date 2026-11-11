---
feature: Cookie notice and click-to-load media
phase: 07
route: /hub/website?tab=pages
---

# How to: Cookie notice and click-to-load media

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

One consent rule for everything your site loads from other companies (CONT-34, D279): videos from YouTube or Vimeo, Spotify and other audio players, Calendly and Google Calendar booking calendars, and maps. Each one waits behind a placeholder until the visitor chooses to load it. The cookie notice appears only on sites that have one of these; simple sites never show it.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/website?tab=pages` | Click a page name, for example **Home** | The page builder opens at `/hub/website/pages/[pageId]` |
| 2 | `/hub/website/pages/[pageId]` | In a Columns block, click **Add item**, choose **Video**, paste a YouTube link into the link field, fill **Title** (for example "Spring menu tour") and click **Save item** | The video item is listed in the column. (Adding a **Map** block works the same way.) |
| 3 | `/hub/website/pages/[pageId]` | Click **Publish changes** | The page is published. Nothing else to switch on: the site now shows the cookie notice to new visitors. A site with no video links, audio links, booking calendars or maps never shows it |

## Use

These steps are on the published site, as a visitor sees it.

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Published page, first visit | Open the page | The cookie notice sits at the bottom of the screen: "This site uses cookies for embedded videos from other companies. Choose what to allow." with **Accept all** and **Only necessary**, both the same size and style. The page above still works |
| 2 | Published page, the video | Look at the video | It shows its cover picture (or a plain panel) with a round play button, and under it "Plays from YouTube, which may set cookies." Nothing has loaded from YouTube yet |
| 3 | Published page, the video | Click the play button | That video loads in the same space and focus moves into it. Other videos and maps on the page stay as placeholders. The cookie notice stays until a choice is made |
| 4 | Cookie notice | Click **Accept all** | The notice fades away, every video and map on the page loads at once, and on later visits (for 180 days) they load without a click and no notice shows |
| 5 | Cookie notice | Click **Only necessary** instead | The notice fades away and every video and map stays a placeholder; each one still loads with its own click |
| 6 | Published page with an automatic pop-up | Open the page on a computer | The pop-up waits until the cookie notice is answered, then appears (its delay counts from the choice) |
| 7 | Published page on a phone (narrower than 768 px) | Open the page | No automatic pop-up appears. A button set to open the pop-up still opens it |
| 8 | Pop-up with an uploaded video | Open the pop-up, then close it | The video starts playing muted when the pop-up opens and stops when it closes. A YouTube or Vimeo video in a pop-up never plays on its own and stops when the pop-up closes |
| 9 | Site footer | Click **Cookie choices** (the footer arrives with plan 07-25) | The cookie notice appears again; a new choice replaces the old one |

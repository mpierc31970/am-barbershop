---
feature: Audio item
phase: 07
route: /hub/website/pages/[pageId]
---

# How to: Audio item

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

An audio player inside a column, a slide, a tab or a pop-up (CONT-27). Pick an MP3 from your media, or paste a link from Spotify, SoundCloud or Apple Podcasts; only the link is kept. Spotify, SoundCloud and Apple players load only after the visitor agrees ([Cookie consent](cookie-consent.md)).

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/sign-in` | Type your **Email** and **Password**, click **Sign in** | The **Website** screen opens at `/hub/website` on the **Pages** tab |
| 2 | `/hub/website?tab=pages` | Click the page title | The page builder opens at `/hub/website/pages/[pageId]` |
| 3 | `/hub/website/pages/[pageId]` | Click a **Columns** row in the block list (or a slide, a tab panel or a pop-up) | The Columns form opens |
| 4 | Columns form, a column | Click **Add item**, then **Audio** under **Photos and media** | A new Audio item is added and its form opens on **Source** with **From your media** selected |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Audio item form | Under **Source** keep **From your media**, click **Choose audio**, click an MP3, click **Use this audio** | The MP3's name shows in the **Audio** field |
| 2 | Audio item form | Or click **Paste a link** and paste a Spotify link into **Paste a link from Spotify, SoundCloud or Apple Podcasts** | A card reads **Spotify found** with **Open on Spotify** and **Play preview** |
| 3 | Audio item form | Click **Play preview** | The Spotify player loads inside the card |
| 4 | Audio item form | Paste a YouTube link instead | The field error reads "We can't play audio from this site. Use Spotify, SoundCloud or Apple Podcasts, or upload an MP3 instead." |
| 5 | Audio item form | Click **Save item** with **Title** empty | The error reads "Add a title for this audio." and the Title field is focused |
| 6 | Audio item form | Fill **Title**, click **Save item** | The item row reads `Audio · "<your title>"`. The header reads **Draft saved · Unpublished changes** |
| 7 | Page builder header | Click **Publish changes** | The header reads **Published** |
| 8 | Your site, the page | Look at an MP3 item | The title shows above a player the full width of the column. Press play: the MP3 plays from your site |
| 9 | Your site, the page | Look at a Spotify item | A placeholder reads "Loads Spotify, which may set cookies." with **Play from Spotify**. Click it: the Spotify player loads |

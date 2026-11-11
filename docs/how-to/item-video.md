---
feature: Video item
phase: 07
route: /hub/website/pages/[pageId]
---

# How to: Video item

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

A video inside a column, a slide, a tab or a pop-up (CONT-17). Pick an MP4 from your media, or paste a link or the embed code from YouTube, Vimeo, Wistia, Loom, Facebook, Instagram, X or TikTok; only the link is kept, never the code. A pasted YouTube link brings its cover into **Website › Media** for you (D119), so the site never loads a picture from YouTube. Uploading MP4s and captions is in [Upload a video](video-upload.md); what visitors see before they agree to cookies is in [Cookie consent](cookie-consent.md).

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/sign-in` | Type your **Email** and **Password**, click **Sign in** | The **Website** screen opens at `/hub/website` on the **Pages** tab |
| 2 | `/hub/website?tab=pages` | Click the page title | The page builder opens at `/hub/website/pages/[pageId]` |
| 3 | `/hub/website/pages/[pageId]` | Click a **Columns** row in the block list (or a slide, a tab panel or a pop-up) | The Columns form opens |
| 4 | Columns form, a column | Click **Add item**, then **Video** under **Photos and media** | A new Video item is added and its form opens on **Where's the video?** with **From your media** selected |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Video item form | Under **Where's the video?** keep **From your media**, click **Choose a video**, click an MP4, click **Use this video** | The video's poster and name show in the **Video** field. A video still being optimized shows "We're optimizing your video for fast playback. This takes a minute or two." |
| 2 | Video item form | Click **Paste a link** under **Where's the video?** | The field **Paste a link or embed code from YouTube, Vimeo, Wistia, Loom, Facebook, Instagram, X or TikTok** appears |
| 3 | Video item form | Paste a YouTube link into that field | A card reads **YouTube video found** with **Open on YouTube** and **Play preview**. A moment later the video's cover appears in the card and in the **Cover** field, and it is saved in **Website › Media** as a photo |
| 4 | Video item form | Click **Play preview** | The real YouTube player loads inside the card. **Hide preview** closes it |
| 5 | Video item form | Paste a link from any other site instead | The field error reads "We can't show videos from this site. Use YouTube, Vimeo, Wistia, Loom, Facebook, Instagram, X or TikTok, or upload it as an MP4 instead." |
| 6 | Video item form | Fill **Title** ("Used by screen readers and search engines") | — |
| 7 | Video item form | Under **Cover** ("We use the video's own cover unless you choose one."), click **Replace** and pick a photo | Your photo replaces the cover. A cover you choose is never replaced by a pasted link |
| 8 | Video item form | Choose a **Shape**: **Wide 16:9**, **Tall 9:16** or **Square 1:1** | The chosen card is marked; each card shows the shape drawn |
| 9 | Video item form | Under **Playback**, tick or clear **Show controls** and **Loop**; for an MP4, tick **Play silently when it appears** ("Starts muted. Visitors can turn the sound on.") | — (the autoplay box is not offered for links) |
| 10 | Video item form, MP4 | Under **Captions**, click **Add captions file** and choose a `.vtt` file | The row reads **captions.vtt** with **Replace** and **Remove**, and "Captions added." shows. Any other file shows "This isn't a captions file we can use. Upload a .vtt file under 512 KB." **Manage in Media** opens the video in **Website › Media** in a new tab |
| 11 | Video item form | Click **Save item** with **Title** empty | The error reads "Add a title. Screen readers and search engines use it." and the Title field is focused |
| 12 | Video item form | Fill **Title**, click **Save item** | The item row reads `Video · "<your title>"`. The header reads **Draft saved · Unpublished changes** |
| 13 | Page builder header | Click **Publish changes** | The header reads **Published** |
| 14 | Your site, the page | Look at an MP4 video | It shows its cover with a round play button in the chosen shape. Click it: the video plays with its controls (and captions under **CC**) |
| 15 | Your site, the page | Scroll to an MP4 with **Play silently when it appears** | It starts muted once half of it is on screen and pauses when you scroll away. With controls off, a **Pause video** button sits in its corner. With **Reduce motion** on in your device settings it never starts by itself |
| 16 | Your site, the page | Look at a YouTube video | A placeholder shows your cover, "Plays from YouTube, which may set cookies." and a play button. Nothing loads from YouTube until you click it or choose **Accept all** |
| 17 | Your site, a pop-up with an MP4 | Open the pop-up, then close it | The video plays muted when the pop-up opens and stops when it closes |

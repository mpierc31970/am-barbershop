---
feature: Video upload
phase: 07
route: /hub/website?tab=media
---

# How to: Upload a video to your site

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

MP4 videos up to 250 MB go into **Website › Media**. The browser sends the file in small parts, then CDS optimizes it for fast playback in the background (D220): you can leave the page while that happens. One video is optimized at a time, so a second one waits its turn. Captions (a `.vtt` file) and a cover photo are set in the video's drawer.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub` | Click **Website** in the sidebar, then the **Media** tab | The Media tab opens at `/hub/website?tab=media` with **Upload files**. Video upload is part of every site, with nothing to install |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Website › Media | Click **Upload files** and choose an MP4 under 250 MB | A tile appears with a progress bar, "Uploading… 12%", a Stop button and the line "Keep this page open until the upload finishes." |
| 2 | Website › Media | Wait for the upload to finish | The tile shows the **Waiting to optimize** badge and "Another video is being optimized first." while another video is working, then **Optimizing** with a moving bar and "We're optimizing your video for fast playback. This takes a minute or two." |
| 3 | Any other hub page, then back to Website › Media | Leave the page while the video is optimizing, then come back | The tile shows its current state; the page checks every 10 seconds while a video is waiting or optimizing |
| 4 | Website › Media | Wait on the page until it finishes | The tile shows the poster with a play mark and the length ("0:42 · 18 MB"), and a toast reads "Tour.mp4 is ready." |
| 5 | Website › Media | If a tile shows **Couldn't optimize**, click **Try again** | A toast reads "Optimizing again." and the tile goes back to Waiting to optimize. If it fails a second time it reads "We couldn't optimize this video. Try exporting it again as MP4." with **Remove** |
| 6 | Media drawer, a ready video | Click the video tile, then drop a `.vtt` file on **Captions file (.vtt)** | A toast reads "Captions saved." and the section shows "captions.vtt" with **Replace** and **Remove**. Another file type or one over 512 KB shows "This isn't a captions file we can use. Upload a .vtt file under 512 KB." |
| 7 | Media drawer, Cover | Click **Choose a different cover**, pick a photo and click **Use this photo** | A toast reads "Cover saved." and the cover shows the photo; **Use the generated cover** puts the original frame back |
| 8 | Website › Media | Upload an MP4 over 250 MB, then a .mov file | Each tile shows its error at once without uploading: "This video is 412 MB. The limit is 250 MB: export a shorter or smaller copy, or upload it to YouTube and paste the link." and "This isn't an MP4 video. Export it as MP4 and try again." with **Remove** |

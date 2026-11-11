---
feature: Media library
phase: 07
route: /hub/website?tab=media
---

# How to: Keep your photos, videos and audio in one place

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

**Website › Media** holds every photo, MP4 video and MP3 your site owns. Upload a file once, then use it on any page through the picker. Photos need a short description (alt text) before they are used on a page; a big drop of photos lands flagged **Needs description** and one list lets you describe them all by pressing Tab (D280). Each site has 2 GB of media (D278). The owner, admins and editors can upload, describe and delete; viewers see the library read-only.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub` | Click **Website** in the sidebar, then the **Media** tab | The Media tab opens at `/hub/website?tab=media`. Media is part of every site, with nothing to install. With no files yet it reads "No media yet" with a drop zone and **Upload files** |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Website › Media | Click Upload files and choose three photos (on a phone the button reads Choose files) | Three tiles appear first in the grid, each with a progress bar, "Uploading… 42%" and a Stop button, uploading one after another. Each becomes a normal tile with a Needs description badge, and a toast reads "3 photos uploaded. Add their descriptions so everyone can see them." with Describe them |
| 2 | Toast, or the notice link above the grid | Click Describe them | The Describe your photos list opens (view=describe in the address bar) with "3 left". Each row shows the photo and a Description of NAME field with a suggestion already selected |
| 3 | Describe your photos | Type "Loaves cooling on a rack" in the first field and press Tab | Focus moves to the next field, the first row collapses to "Saved: Loaves cooling on a rack" and the count reads "2 left" |
| 4 | Describe your photos | Describe the second photo the same way. For the third, where the suggestion is already right, click Use this under its field | The list shows "Every photo has a description" with Back to all media |
| 5 | Website › Media | Click Images, then Videos in the filter above the grid | Each choice shows its count ("Images 3") and only that kind of file. All brings everything back. Audio appears as a fourth choice once an MP3 is in the library |
| 6 | Website › Media | Type "loaves" in Search by name or description and pause | After a moment only files whose name or description contains "loaves" are shown, and the address bar keeps q=loaves |
| 7 | Website › Media | Click a photo tile | A drawer titled with the file name opens on the right with the photo, Size, Dimensions, Added, Used on (page links, or "Not used on any page") and Description. Change the description and click Save description: a toast reads "Description saved." |
| 8 | Media drawer, a photo no page uses | Click Delete photo, then Delete photo in the dialog | The dialog reads "It's deleted for good and stops loading anywhere." with Keep photo focused. After deleting, a toast reads "Photo deleted." and the tile is gone |
| 9 | Media drawer, a photo used on Home | Click Delete photo | The dialog body reads "It leaves your media. Pages that use it now, and older versions you might restore, keep showing it until you change them." Delete it: Home still shows the photo, and it is gone from Media and the picker |
| 10 | Website › Media | Upload an MP3 under 50 MB | The tile shows a sound-wave icon, its length and size, like "3:12 · 4.4 MB". A file over 50 MB or not an MP3 shows "This isn't an MP3 file, or it's over 50 MB. Export an MP3 under 50 MB and try again." |
| 11 | Website › Media | Look under the Media heading | The meter reads like "1.2 GB of 2 GB used" (2 GB plus any storage packs). From 80% a warning reads "You've used 1.7 GB of your 2 GB of media…" with an Add storage link. At 100% Upload files is replaced by Add 5 GB and Add 25 GB buttons showing the current monthly price (like Add 5 GB for $5/mo), with "You've used all 2 GB of your media storage. Add more, or delete something to make room." under the meter (Admins and Editors read "Media storage is full. Ask your site owner to add more, or delete something to make room.") |
| 12 | Page builder, an Image item | Click Choose a photo, pick a photo in the Choose a photo window and click Use this photo | The picker lists your photos with search and an Upload tab. A photo without a description shows a Description field above the button, and Use this photo stays off until it is saved. After Use this photo the item shows the photo with its description |

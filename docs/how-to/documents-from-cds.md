---
feature: Documents from Support
phase: 12
route: /hub/support?tab=documents
---

# How to: Documents from Support

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Documents keeps every file in one place: files Support shares with your site (reports, proofs, guides), and every file attached to your tickets and messages, by you or by Support. Downloads use a private link that works for 15 minutes, so files never sit on a public address.

## Activate

Nothing to turn on: Documents is a tab of Support for everyone on your site.

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/support` | Click the **Documents** tab | Two sections: **Shared by Support** and **From your tickets and messages**. With nothing shared yet: "Files Support shares with you will appear here." |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/support?tab=documents` | Read **Shared by Support** | Newest first: each row has the file type, the title, Support's note about it and "From Support · 9 Oct · 1.2 MB". A document you haven't opened yet shows **New**; opening the tab marks them read |
| 2 | `/hub/support?tab=documents` | Click **Download** on a document | The file downloads through a private link made at that moment |
| 3 | `/hub/support?tab=documents` | Under **From your tickets and messages**, click **All**, **From Support** or **From you** | The file list filters in place. Each row shows the file name, where it came from ("In ticket #1042" or "In Messages", both links), who sent it ("Mara · Support", "You" or a team member), the date and the size |
| 4 | `/hub/support?tab=documents` | Click the download icon on a file | It downloads. A file still being checked shows **Checking file** and can't be downloaded yet: "This file is still being checked. Try again later." |
| 5 | `/hub/support?tab=documents`, more than 50 rows | Click **Show more**, then **Show older documents** or **Show older files** at the end | Older rows load below |
| 6 | A download link opened more than 15 minutes later (or shared with someone) | Open it | A page "This download link has expired" reads "Download links work for 15 minutes. Go back to Documents and tap Download again." with **Go to Documents** |
| 7 | Any hub screen | When Support shares a document | The bell shows "Support shared a document: {title}" with the Support mark, and you get an email (Profile › Alerts, row **Documents from Support**) |

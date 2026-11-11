---
feature: Booking calendar item
phase: 07
route: /hub/website/pages/[pageId]
---

# How to: Booking calendar item

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

A Calendly scheduler or a public Google Calendar inside a column, a slide, a tab or a pop-up (CONT-27). Only these two are allowed, and only the link is kept, never embed code. The calendar loads only after the visitor agrees ([Cookie consent](cookie-consent.md)).

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/sign-in` | Type your **Email** and **Password**, click **Sign in** | The **Website** screen opens at `/hub/website` on the **Pages** tab |
| 2 | `/hub/website?tab=pages` | Click the page title | The page builder opens at `/hub/website/pages/[pageId]` |
| 3 | `/hub/website/pages/[pageId]` | Click a **Columns** row in the block list (or a slide, a tab panel or a pop-up) | The Columns form opens |
| 4 | Columns form, a column | Click **Add item**, then **Booking calendar** under **Actions** | A new Booking calendar item is added and its form opens |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Booking calendar item form | Paste your Calendly link into **Paste your Calendly or public Google Calendar link** | A card reads **Calendly found** with **Open on Calendly** and **Play preview** |
| 2 | Booking calendar item form | Click **Play preview** | Your Calendly scheduler loads inside the card (scroll inside it to see all of it). **Hide preview** closes it |
| 3 | Booking calendar item form | Paste a link from any other site instead | The field error reads "This site isn't on the allowed list. You can add a Calendly or public Google Calendar link." |
| 4 | Booking calendar item form | Fill **Title** ("For example, Book a consultation") | — |
| 5 | Booking calendar item form | Click **Save item** with **Title** empty | The error reads 'Add a title, like "Book a consultation".' and the Title field is focused |
| 6 | Booking calendar item form | Fill **Title**, paste the Calendly link again, click **Save item** | The item row reads `Booking calendar · "<your title>"`. The header reads **Draft saved · Unpublished changes** |
| 7 | Page builder header | Click **Publish changes** | The header reads **Published** |
| 8 | Your site, the page | Look at the booking calendar | A placeholder reads "Loads Calendly, which may set cookies." with **Show booking calendar** |
| 9 | Your site, the page | Click **Show booking calendar** | The calendar loads at its full height, the width of the column |

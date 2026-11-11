---
feature: Slider block
phase: 07
route: /hub/website/pages/[pageId]
---

# How to: Slider block

Final steps against the built slides editor and the live slider (07-20).

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Slides that change, each one a row of columns with its own content; up to 10 slides (CONT-23).

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/sign-in` | Type your **Email** and **Password**, click **Sign in** | The **Website** screen opens at `/hub/website` on the **Pages** tab |
| 2 | `/hub/website?tab=pages` | Click the page title | The page builder opens at `/hub/website/pages/[pageId]` |
| 3 | `/hub/website/pages/[pageId]` | Click **Add block** | The right pane shows **Add a block** |
| 4 | **Add a block** | Under **Photos and video**, click **Slider** | A Slider row is added and selected, and its form opens with 2 empty slides |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | **Slider** form | Type a **Heading**, for example "Our spring menu" (optional) | The heading names the slider for visitors and screen readers |
| 2 | **Slider** form, **Slides** | Click **Slide 1** | The slide opens below its row in the Columns editor, with the layout picker and **Add item** |
| 3 | Open slide | Click **Add item**, then pick from **Text**, **Photos and media**, **Actions** or **Other** (for example **Heading**), fill it in and click **Save item** | The item shows in the slide. The row now reads "Slide 1 · " and the first heading's text |
| 4 | **Slides** | Click **Slide 2** | Slide 1 closes (its open item form is saved first) and Slide 2 opens |
| 5 | **Slides** | On a slide row, click **More actions for Slide 1 …**, then **Duplicate slide** | A copy of the slide is added right after it. At 10 slides **Add slide** is off and reads "A slider holds up to 10 slides." |
| 6 | **Slides** | Drag a row by its grip, or click **Move up** / **Move down** on the row | The slide moves and its new position is announced |
| 7 | **Slides** | Click **More actions for Slide 2**, then **Delete slide** | The slide goes and a toast reads "Slide 2 removed." with **Undo**; **Undo** (within 8 seconds) puts it back in place. The last slide cannot be deleted |
| 8 | **Slider** form | Click **Add slide** | An empty slide is added at the end and opens |
| 9 | **Slider** form | Choose **Direction**: **Left to right**, **Right to left** or **Top to bottom** | The chosen card is selected. Top to bottom slides sideways on phones |
| 10 | **Slider** form, **Controls** | Set **Arrows** and **Dots**; turn on **Auto-play** and pick **Change every** 3, 5 or 8 seconds | **Change every** appears only while Auto-play is on. With Arrows and Dots both off, visitors still get Previous and Next |
| 11 | **Slider** form | Choose **Transition**: **Slide** or **Fade** | The chosen card is selected |
| 12 | Form footer | Click **Save block** | Every slide change, including an item form still open, is saved. **Saved** shows for 3 seconds and the header reads **Draft saved · Unpublished changes** |
| 13 | Page header | Click **Preview page**, then **Publish changes** | A toast reads **Published. Your changes are live.** |
| 14 | The live page | Look under the slides | One bar of controls: **Pause slides** (with Auto-play), **Previous slide**, a dot per slide, **Next slide** |
| 15 | The live page | With Auto-play on, hover the slider or tab into it, then click **Pause slides** | Slides stop while you hover or focus; **Pause slides** stops them and the button reads **Play slides** |
| 16 | The live page | Click **Next slide** or a dot, or swipe on a phone | That slide shows, and auto-play stops for the rest of the visit |
| 17 | The live page, reduced motion on (OS setting) | Open the page | The slider never moves on its own and slides change with no animation |

Empty slides are skipped on the live page; a slider with no filled slides shows nothing.

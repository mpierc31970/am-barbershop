// The "Use" steps of docs/how-to/media-library.md, baked for the hub (07-17; D110, CONT-21).
// "How Media works" on Website › Media opens them in the P5 TrainingDrawer, the same way add-on
// training shows its baked how-to steps (the standalone bundle ships without docs/). A drift
// test (apps/web/test/media-tab.test.tsx) parses the how-to with the add-on generator's
// parseUseSteps and fails when these differ. Pure.
import type { HowToStepView } from "@cds/ui/hub";

export const MEDIA_HOWTO = "docs/how-to/media-library.md";

export const MEDIA_TITLE = "How Media works";

export const MEDIA_STEPS: readonly HowToStepView[] = Object.freeze([
  {
    screen: "Website › Media",
    action:
      "Click Upload files and choose three photos (on a phone the button reads Choose files)",
    expected:
      'Three tiles appear first in the grid, each with a progress bar, "Uploading… 42%" and a Stop button, uploading one after another. Each becomes a normal tile with a Needs description badge, and a toast reads "3 photos uploaded. Add their descriptions so everyone can see them." with Describe them',
  },
  {
    screen: "Toast, or the notice link above the grid",
    action: "Click Describe them",
    expected:
      'The Describe your photos list opens (view=describe in the address bar) with "3 left". Each row shows the photo and a Description of NAME field with a suggestion already selected',
  },
  {
    screen: "Describe your photos",
    action: 'Type "Loaves cooling on a rack" in the first field and press Tab',
    expected:
      'Focus moves to the next field, the first row collapses to "Saved: Loaves cooling on a rack" and the count reads "2 left"',
  },
  {
    screen: "Describe your photos",
    action:
      "Describe the second photo the same way. For the third, where the suggestion is already right, click Use this under its field",
    expected:
      'The list shows "Every photo has a description" with Back to all media',
  },
  {
    screen: "Website › Media",
    action: "Click Images, then Videos in the filter above the grid",
    expected:
      'Each choice shows its count ("Images 3") and only that kind of file. All brings everything back. Audio appears as a fourth choice once an MP3 is in the library',
  },
  {
    screen: "Website › Media",
    action: 'Type "loaves" in Search by name or description and pause',
    expected:
      'After a moment only files whose name or description contains "loaves" are shown, and the address bar keeps q=loaves',
  },
  {
    screen: "Website › Media",
    action: "Click a photo tile",
    expected:
      'A drawer titled with the file name opens on the right with the photo, Size, Dimensions, Added, Used on (page links, or "Not used on any page") and Description. Change the description and click Save description: a toast reads "Description saved."',
  },
  {
    screen: "Media drawer, a photo no page uses",
    action: "Click Delete photo, then Delete photo in the dialog",
    expected:
      'The dialog reads "It\'s deleted for good and stops loading anywhere." with Keep photo focused. After deleting, a toast reads "Photo deleted." and the tile is gone',
  },
  {
    screen: "Media drawer, a photo used on Home",
    action: "Click Delete photo",
    expected:
      'The dialog body reads "It leaves your media. Pages that use it now, and older versions you might restore, keep showing it until you change them." Delete it: Home still shows the photo, and it is gone from Media and the picker',
  },
  {
    screen: "Website › Media",
    action: "Upload an MP3 under 50 MB",
    expected:
      'The tile shows a sound-wave icon, its length and size, like "3:12 · 4.4 MB". A file over 50 MB or not an MP3 shows "This isn\'t an MP3 file, or it\'s over 50 MB. Export an MP3 under 50 MB and try again."',
  },
  {
    screen: "Website › Media",
    action: "Look under the Media heading",
    expected:
      'The meter reads like "1.2 GB of 2 GB used" (2 GB plus any storage packs). From 80% a warning reads "You\'ve used 1.7 GB of your 2 GB of media…" with an Add storage link. At 100% Upload files is replaced by Add 5 GB and Add 25 GB buttons showing the current monthly price (like Add 5 GB for $5/mo), with "You\'ve used all 2 GB of your media storage. Add more, or delete something to make room." under the meter (Admins and Editors read "Media storage is full. Ask your site owner to add more, or delete something to make room.")',
  },
  {
    screen: "Page builder, an Image item",
    action:
      "Click Choose a photo, pick a photo in the Choose a photo window and click Use this photo",
    expected:
      "The picker lists your photos with search and an Upload tab. A photo without a description shows a Description field above the button, and Use this photo stays off until it is saved. After Use this photo the item shows the photo with its description",
  },
]);

// Rating card copy (13-42 choice 1; 13-UI-SPEC lines 935-958, 1043, 1107). Server-safe (no
// "use client"), so the rating action reads the same strings. RATING-Q / Yes / No come from
// P13_COPY; the rest is the UI-SPEC section copy.
import { P13_COPY } from "@cds/core/staff";
import { RATING_COMMENT_MAX, type RatingChoice } from "@cds/core/support";

export const RATING_CARD_COPY = Object.freeze({
  question: P13_COPY.RATING_Q,
  yes: P13_COPY.RATING_YES,
  no: P13_COPY.RATING_NO,
  yesName: "Yes, resolved well",
  noName: "No, not resolved well",
  thanks: "Thanks. CDS reads every rating.",
  comment: "Anything to add?",
  saveComment: "Save comment",
  savingComment: "Saving…",
  commentSaved: "Comment saved.",
  saveRating: "Save rating",
  savingRating: "Saving…",
  ratingSaved: "Thanks. Your rating is saved.",
  impersonating: "Ratings are turned off while viewing as CDS staff.",
  rated: (choice: RatingChoice) =>
    `You rated this ${choice === "up" ? P13_COPY.RATING_YES : P13_COPY.RATING_NO}.`,
  notRated: "Not rated yet.",
  commentTooLong: `Keep it to ${RATING_COMMENT_MAX} characters.`,
});

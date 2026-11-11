// SUPPORT_UI_COPY (12-06 choice 6): every P12 screen copy ID from the 12-UI-SPEC Copywriting
// Contract (lines 757-824), keyed by the ID with "-" → "_" (MSG-EMPTY-H → MSG_EMPTY_H), plus
// the button labels and the undo toasts. The CONTEXT anchors that the db layer, CLIs and jobs
// share live in @cds/core/support SUPPORT_COPY (12-03) and are re-exported here, never
// retyped. Templates with {name} / {query} / {email} are functions. Plain, browser-safe.
import { SUPPORT_COPY } from "@cds/core/support";

/** Button and link labels (UI-SPEC "Primary CTA" and "Secondary actions"). */
const BUTTONS = Object.freeze({
  getHelp: "Get help",
  sendToCds: "Send to Support",
  sendReply: "Send reply",
  sending: "Sending…",
  postIdea: "Post idea",
  posting: "Posting…",
  getQuote: "Get a quote",
  viewQuote: "View quote",
  useCareHour: "Use my Care hour",
  applyChanges: "Apply my changes",
  sendMessage: "Send message",
  attachFiles: "Attach files",
  remove: (name: string) => `Remove ${name}`,
  tryAgain: "Try again",
  thisIsSolved: "This is solved",
  openNewTicket: "Open a new ticket",
  showMeHow: "Show me how",
  notNow: "Not now",
  download: "Download",
  suggestFeature: "Suggest a feature",
  suggestIt: "Suggest it",
  discard: "Discard",
  discardChanges: "Discard my changes",
  showEarlier: "Show earlier messages",
  showMore: "Show more",
  dismiss: "Dismiss",
  readReply: "Read reply",
  reply: "Reply",
  readMessage: "Read message",
  readNote: "Read note",
  chooseOption: "Choose an option",
  reviewChanges: "Review changes",
  seeDetails: "See details",
  askCds: "Ask Support",
  whatSupportIncludes: "What support includes",
  whatHappened: "What happened",
  goToDocuments: "Go to Documents",
  undo: "Undo",
  leave: "Leave",
  keepWriting: "Keep writing",
});

export const SUPPORT_UI_COPY = Object.freeze({
  BUTTONS,
  BYLINE: "From the support team",

  MSG_EMPTY_H: "No messages yet",
  MSG_EMPTY_B: "Write to Support any time.",
  TICKETS_EMPTY_H: "No tickets",
  /** "Need help?" followed by the Get help link (BUTTONS.getHelp). */
  TICKETS_EMPTY_B: "Need help?",
  DOCS_EMPTY: "Files Support shares with you will appear here.",
  IDEAS_INTRO:
    "Ideas from sites for things Support could build. Vote for the ones you'd use. One vote per site.",
  IDEAS_EMPTY: Object.freeze({
    suggested: "No ideas yet. Suggest one.",
    considering: "Nothing being considered right now.",
    planned: "Nothing planned right now.",
    built: "Nothing built from ideas yet.",
  }),
  /** IDEAS-NOMATCH lead; the "Suggest it" link (BUTTONS.suggestIt) and tail follow. */
  IDEAS_NOMATCH: (query: string) => `No ideas match "${query}".`,
  IDEAS_NOMATCH_TAIL: "as a new idea.",
  SIMILAR_HEAD: "Already suggested? Vote for one of these instead.",
  CONTEXT_NOTE:
    "We include the screen you came from and your browser, to help us look into it.",
  HELD_APPLY_NOTE:
    "Applying puts them in your draft. Support's fix stays in this page's history, so you can switch back.",
  LOCKED_BODY:
    "You can look around, but changes are paused so nothing clashes with Support's fix.",
  ATTACH_HINT: "You can also paste a screenshot or drop files here.",
  FILE_RULES:
    "Up to 5 files, 10 MB each: images, PDF, text, spreadsheets and Office documents.",
  FILE_TOO_BIG: (name: string) =>
    `${name} is larger than 10 MB. Try a smaller file or a screenshot.`,
  FILE_TYPE: (name: string) =>
    `${name} can't be attached. Use an image, PDF, text, spreadsheet or Office document.`,
  /** The scanner refused the file (review IN-B01): no type advice, the type was fine. */
  FILE_REFUSED: (name: string) =>
    `${name} can't be attached. Try a different file.`,
  FILE_TOO_MANY:
    "You can attach up to 5 files at a time. Send these, then add more.",
  FILE_FAILED: (name: string) => `Couldn't upload ${name}.`,
  MSG_REQUIRED: "Write a message or attach a file first.",
  TYPE_REQUIRED: "Choose what you need.",
  SUBJECT_REQUIRED: "Add a short subject.",
  BODY_REQUIRED: "Tell us a bit more so we can help.",
  RATE_TICKETS:
    "Your site has sent a lot of tickets today. Add to an open ticket, or try again tomorrow.",
  RATE_MESSAGES:
    "You've sent a lot of messages in the last hour. Try again in a few minutes. Your text is kept.",
  RATE_UPLOADS:
    "Your site has uploaded a lot of files today. Try again tomorrow, or describe it in words for now.",
  ERR_SEND:
    "That didn't send. Check your connection and try again. Your text is kept.",
  ERR_VOTE: "Your vote didn't save. Try again.",
  /** ERR-LOAD / ERR-SECTION / ERR-SAVE: P11 copy, unchanged. */
  ERR_LOAD: "We couldn't load this. Check your connection and try again.",
  ERR_SECTION: "We couldn't load this part. The rest of the page is fine.",
  ERR_SAVE: "That didn't save. Check your connection and try again.",
  LINK_EXPIRED:
    "Download links work for 15 minutes. Go back to Documents and tap Download again.",
  VIEWER_READONLY:
    "You can read support but not write. Ask your site owner for Editor access.",
  IMPERSONATING_SUPPORT:
    "You're viewing as support staff, so filing and replying are turned off here. Use support:reply to answer.",
  SUPPORT_EMAIL_FALLBACK: (email: string) =>
    `Can't use your hub right now? Email ${email}.`,

  /** Destructive actions (UI-SPEC lines 812-822): undo toasts and the nav guard. */
  TOAST_SOLVED: "Marked as solved.",
  TOAST_DISCARDED: "Your held changes were discarded.",
  LEAVE_H: "Leave without sending?",
  LEAVE_B: "Your ticket isn't sent yet.",

  /** CONTEXT anchors, re-exported from @cds/core/support (never retyped). */
  SLA_LINE: SUPPORT_COPY.SLA_LINE,
  PAID_RULE: SUPPORT_COPY.PAID_RULE,
  PAID_ASK_OWNER: SUPPORT_COPY.PAID_ASK_OWNER,
  RESOLVED_NOTE: SUPPORT_COPY.RESOLVED_NOTE,
  CLOSED_NOTE: SUPPORT_COPY.CLOSED_NOTE,
  HELD_KEPT: SUPPORT_COPY.HELD_KEPT,
  IDEA_PUBLIC: SUPPORT_COPY.IDEA_PUBLIC,
  NO_REPLY_FOOTER: SUPPORT_COPY.NO_REPLY_FOOTER,
  NOTICE_ACTIVE: SUPPORT_COPY.NOTICE_ACTIVE,
  NOTICE_PLANNED: SUPPORT_COPY.NOTICE_PLANNED,
});

export type SupportUiCopy = typeof SUPPORT_UI_COPY;

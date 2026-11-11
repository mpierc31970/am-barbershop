// Staff dialog copy (13-09; 13-UI-SPEC "StepUpDialog", "Destructive and irreversible
// actions"). The dialog chrome words. Error copy IDs (CODE-WRONG, CODE-EXPIRED, RATE-SIGNIN,
// SESSION-ENDED) and the per-action titles (P13_DIALOGS) stay in @cds/core/staff.

export const STAFF_DIALOG_COPY = {
  stepUpTitle: "Confirm it's you",
  stepUpBody: (email: string) =>
    `This action needs a fresh code. We emailed one to ${email}.`,
  stepUpSending: "Sending a code to your staff email…",
  stepUpNoCode: "No code was sent. Send a new code to try again.",
  stepUpThen: (what: string) => `Then: ${what}`,
  stepUpConfirm: "Confirm and continue",
  stepUpConfirming: "Confirming…",
  stepUpStop: "Stop this action",
  stepUpResend: "Send a new code",
  stepUpCooldown: (sec: number) => `You can ask again in ${sec}s`,
  stepUpSent: "Code sent",
  working: "Working…",
  reasonCount: (n: number, max: number) => `${n} / ${max}`,
} as const;

/** Codes the step-up server actions return (13-21) → which copy ID the dialog shows. */
export const STEP_UP_ERROR_CODES = {
  code_wrong: "CODE_WRONG",
  code_expired: "CODE_EXPIRED",
  rate_limited: "RATE_SIGNIN",
  session_ended: "SESSION_ENDED",
} as const;

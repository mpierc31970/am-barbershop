// Hub status Badge (03-UI-SPEC "Color / Hub" status badge table). Label 14/600, 4px
// radius, 4px x 8px padding, text on tint. Never accent, never colour alone: every badge
// carries a word, and Hidden adds the EyeOff icon.
import {
  Ban,
  CircleCheck,
  CirclePause,
  Clock,
  ClockAlert,
  DoorOpen,
  EyeOff,
  Hourglass,
  LoaderCircle,
  Lock,
  Mail,
  PauseCircle,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";

// P5 tones (05-UI-SPEC "Color" status badges): "on-site" (the add-on is on the owner's
// site), "expiring" (credential expires within 60 days), "expired" (hidden on site
// automatically), "addon-off" (a builder block whose add-on was removed). The caller
// supplies the words ("On your site", "Expires soon · 12 Nov", ...).
export type BadgeTone =
  | "draft"
  | "published"
  | "changes"
  | "review"
  | "hidden"
  | "home"
  | "on-site"
  | "expiring"
  | "expired"
  | "addon-off"
  // P6 setup tones (06-UI-SPEC "Color" badges added this phase): "needed" (a required
  // item is empty), "optional" (empty, has a fallback), "done" (step done), "sent" (Sent to
  // CDS). "In review" reuses "review".
  | "needed"
  | "optional"
  | "done"
  | "sent"
  // P6 email route tones (06-22): "waiting" (confirm email sent, not clicked), "confirmed",
  // "bouncing" (danger tint + TriangleAlert, never colour alone).
  | "waiting"
  | "confirmed"
  | "bouncing"
  // P7 Inbox (07-19; 07-UI-SPEC "Color" Unread): ink on #F2F2EF (hub-surface-2).
  | "unread"
  // P7 media (07-17; 07-UI-SPEC "Badges added this phase"): "needs-description" (warning),
  // "waiting-optimize" and "optimizing" (ink-muted on #F2F2EF), "failed" (danger on tint).
  | "needs-description"
  | "waiting-optimize"
  | "optimizing"
  | "failed"
  // P7 history (07-29 choice 14; 07-UI-SPEC "History"): "current" marks the live version
  // (success tint + success ink, like "published").
  | "current"
  // P7 SEO (07-30; 07-UI-SPEC "Header additions"): the "3 to check" warning count.
  | "to-check"
  // P7 protected pages + 404 (07-32; 07-UI-SPEC lines 155-156): "system-page" (the Page not
  // found row) and "password" (a protected page, with Lock 16px): ink-muted on #F2F2EF.
  | "system-page"
  | "password"
  // P8 (08-09; 08-UI-SPEC "New badge"): "being-built" (organizations.stage = being_built,
  // replaces Sent to CDS on /hub/setup). Neutral: ink-muted on #F2F2EF, text only, never accent.
  | "being-built"
  // P9 (09-04; 09-UI-SPEC "New badge tones"): "signed" (success on tint, "Signed"),
  // "not-signed" (the needed colours, "Not signed"), "update-waiting" (warning on tint +
  // TriangleAlert 14px, "Update waiting").
  | "signed"
  | "not-signed"
  | "update-waiting"
  // P10 (10-05; 10-UI-SPEC status tone map, D-UI-P10-12): billing and Stripe states.
  // Default words: Paused (+ PauseCircle 14px), Paid, Due, Unpaid (+ TriangleAlert 14px),
  // Refunded, Cancelled (void), Connected, Not connected, Needs attention (stripe-attention,
  // + TriangleAlert 14px), Waiting for you (quote-waiting). Paused is warning, never danger.
  | "paused"
  | "paid"
  | "due"
  | "unpaid"
  | "refunded"
  | "void"
  | "connected"
  | "not-connected"
  | "stripe-attention"
  | "quote-waiting"
  // P11 (11-33; 11-UI-SPEC "New badge tones"): real-visitor page speed. Good (success),
  // Needs work (warning), Poor (danger + TriangleAlert 14px).
  | "speed-good"
  | "speed-work"
  | "speed-poor"
  // P11 (11-17; 11-UI-SPEC "New badge tones"): Today status line. Ready for your review
  // (warning: something waits on the owner), Live (success).
  | "ready-review"
  | "live"
  // P11 (11-39; 11-UI-SPEC "New badge tones"): People & roles. Invited (warning on tint),
  // role (ink on #F2F2EF: "Owner", "Admin", "Editor", "Viewer", "Staff", "Renter").
  | "invited"
  | "role"
  // P12 (12-06 choice 5; 12-UI-SPEC line 74): ticket status (t-*), idea status (i-*),
  // incident (inc-*) and the file "Checking file" state (+ Clock 14px). Never --cds-* or
  // accent: CDS identity is never a badge. Waiting on you is warning (the ready-review rule).
  | "t-open"
  | "t-progress"
  | "t-waiting"
  | "t-resolved"
  | "t-closed"
  | "i-suggested"
  | "i-considering"
  | "i-planned"
  | "i-built"
  | "inc-open"
  | "inc-resolved"
  | "checking"
  // P13 (13-07 choice 3; 13-UI-SPEC "Staff status tone map", lines 190-221). Staff console
  // only. Prefixes keep the groups together: sla- (first-reply SLA), p- (priority), s- (site
  // stage/status), r- (review queue), h- (health; indexing reuses h-ok/h-critical/h-none),
  // fs- (fail-safe requests). Every one carries its word; icons are aria-hidden.
  | "sla-risk"
  | "sla-missed"
  | "sla-met"
  | "p-urgent"
  | "p-high"
  | "p-normal"
  | "p-low"
  | "internal"
  | "s-intake"
  | "s-fit"
  | "s-ready"
  | "s-held"
  | "s-notice"
  | "s-suspended"
  | "s-closed"
  | "s-lapsed"
  | "s-declined"
  | "demo"
  | "repeat"
  | "abandoned"
  | "r-flag"
  | "r-queued"
  | "r-spot"
  | "r-report"
  | "r-dmca"
  | "r-held"
  | "r-held-late"
  | "h-ok"
  | "h-warn"
  | "h-critical"
  | "h-none"
  | "available"
  | "coming-soon"
  | "rating-up"
  | "rating-down"
  | "fs-pending"
  | "fs-done"
  | "fs-dismissed"
  // P14 (14-30 choice 1; 14-UI-SPEC "Owner domain tone map", "Record class and status
  // badges"). Prefixes keep the groups together: dom- (owner domain status line), rec-
  // (record class and status), g- (staff gate result), m- (staff move step), s-leaving
  // (Leaving CDS). Existing contrast pairs only; every one carries its word.
  | "dom-none"
  | "dom-checking"
  | "dom-cds"
  | "dom-waiting"
  | "dom-ready"
  | "dom-broken"
  | "rec-cds"
  | "rec-email"
  | "rec-yours"
  | "rec-copied"
  | "rec-checking"
  | "rec-added"
  | "rec-pending"
  | "g-match"
  | "g-ttl"
  | "g-mismatch"
  | "g-missing"
  | "g-added"
  | "g-ack"
  | "g-override"
  | "m-waiting"
  | "m-running"
  | "m-done"
  | "m-owner"
  | "m-prepared"
  | "m-failed"
  | "m-skipped"
  | "m-cancelled"
  | "s-leaving";

const TONES: Record<BadgeTone, string> = {
  draft: "bg-hub-surface-2 text-hub-ink-muted",
  published: "bg-hub-success-tint text-hub-success",
  changes: "bg-hub-warning-tint text-hub-warning",
  review: "bg-hub-warning-tint text-hub-warning",
  hidden: "bg-hub-surface-2 text-hub-ink-muted",
  home: "bg-hub-surface-2 text-hub-ink",
  "on-site": "bg-hub-success-tint text-hub-success",
  expiring: "bg-hub-warning-tint text-hub-warning",
  expired: "bg-hub-surface-2 text-hub-ink-muted",
  "addon-off": "bg-hub-surface-2 text-hub-ink-muted",
  needed: "bg-hub-warning-tint text-hub-warning",
  optional: "bg-hub-surface-2 text-hub-ink-muted",
  done: "bg-hub-success-tint text-hub-success",
  sent: "bg-hub-success-tint text-hub-success",
  waiting: "bg-hub-warning-tint text-hub-warning",
  confirmed: "bg-hub-success-tint text-hub-success",
  bouncing: "bg-hub-danger-tint text-hub-danger",
  unread: "bg-hub-surface-2 text-hub-ink",
  "needs-description": "bg-hub-warning-tint text-hub-warning",
  "waiting-optimize": "bg-hub-surface-2 text-hub-ink-muted",
  optimizing: "bg-hub-surface-2 text-hub-ink-muted",
  failed: "bg-hub-danger-tint text-hub-danger",
  current: "bg-hub-success-tint text-hub-success",
  "to-check": "bg-hub-warning-tint text-hub-warning",
  // 07-UI-SPEC line 155: System page, ink-muted on #F2F2EF (hub-surface-2).
  "system-page": "bg-hub-surface-2 text-hub-ink-muted",
  // 07-UI-SPEC line 156: Password, ink-muted on #F2F2EF (hub-surface-2) + Lock 16px.
  password: "bg-hub-surface-2 text-hub-ink-muted",
  // 08-UI-SPEC "New badge": Being built, ink-muted on #F2F2EF (hub-surface-2).
  "being-built": "bg-hub-surface-2 text-hub-ink-muted",
  signed: "bg-hub-success-tint text-hub-success",
  "not-signed": "bg-hub-warning-tint text-hub-warning",
  "update-waiting": "bg-hub-warning-tint text-hub-warning",
  // P10 (10-05)
  paused: "bg-hub-warning-tint text-hub-warning",
  paid: "bg-hub-success-tint text-hub-success",
  due: "bg-hub-warning-tint text-hub-warning",
  unpaid: "bg-hub-danger-tint text-hub-danger",
  refunded: "bg-hub-surface-2 text-hub-ink-muted",
  void: "bg-hub-surface-2 text-hub-ink-muted",
  connected: "bg-hub-success-tint text-hub-success",
  "not-connected": "bg-hub-surface-2 text-hub-ink-muted",
  "stripe-attention": "bg-hub-warning-tint text-hub-warning",
  "quote-waiting": "bg-hub-warning-tint text-hub-warning",
  // P11 (11-33)
  "speed-good": "bg-hub-success-tint text-hub-success",
  "speed-work": "bg-hub-warning-tint text-hub-warning",
  "speed-poor": "bg-hub-danger-tint text-hub-danger",
  // P11 (11-17)
  "ready-review": "bg-hub-warning-tint text-hub-warning",
  live: "bg-hub-success-tint text-hub-success",
  // P11 (11-39)
  invited: "bg-hub-warning-tint text-hub-warning",
  role: "bg-hub-surface-2 text-hub-ink",
  // P12 (12-06)
  "t-open": "bg-hub-surface-2 text-hub-ink",
  "t-progress": "bg-hub-surface-2 text-hub-ink",
  "t-waiting": "bg-hub-warning-tint text-hub-warning",
  "t-resolved": "bg-hub-success-tint text-hub-success",
  "t-closed": "bg-hub-surface-2 text-hub-ink-muted",
  "i-suggested": "bg-hub-surface-2 text-hub-ink",
  "i-considering": "bg-hub-surface-2 text-hub-ink",
  "i-planned": "border border-hub-border-strong bg-hub-surface text-hub-ink",
  "i-built": "bg-hub-success-tint text-hub-success",
  "inc-open": "bg-hub-surface-2 text-hub-ink",
  "inc-resolved": "bg-hub-success-tint text-hub-success",
  checking: "bg-hub-surface-2 text-hub-ink-muted",
  // P13 (13-07)
  "sla-risk": "bg-hub-warning-tint text-hub-warning",
  "sla-missed": "bg-hub-danger-tint text-hub-danger",
  "sla-met": "bg-hub-success-tint text-hub-success",
  "p-urgent": "bg-hub-danger-tint text-hub-danger",
  "p-high": "bg-hub-warning-tint text-hub-warning",
  "p-normal": "bg-hub-surface-2 text-hub-ink",
  "p-low": "bg-hub-surface-2 text-hub-ink-muted",
  internal: "bg-hub-warning-tint text-hub-ink",
  "s-intake": "bg-hub-surface-2 text-hub-ink",
  "s-fit": "bg-hub-warning-tint text-hub-warning",
  "s-ready": "bg-hub-surface-2 text-hub-ink",
  "s-held": "bg-hub-warning-tint text-hub-warning",
  "s-notice": "bg-hub-warning-tint text-hub-warning",
  "s-suspended": "bg-hub-danger-tint text-hub-danger",
  "s-closed": "bg-hub-surface-2 text-hub-ink-muted",
  "s-lapsed": "bg-hub-surface-2 text-hub-ink-muted",
  "s-declined": "bg-hub-surface-2 text-hub-ink-muted",
  demo: "border border-hub-border-strong bg-hub-surface text-hub-ink",
  repeat: "bg-hub-danger-tint text-hub-danger",
  abandoned: "bg-hub-surface-2 text-hub-ink-muted",
  "r-flag": "bg-hub-surface-2 text-hub-ink",
  "r-queued": "bg-hub-surface-2 text-hub-ink",
  "r-spot": "bg-hub-surface-2 text-hub-ink",
  "r-report": "bg-hub-surface-2 text-hub-ink",
  "r-dmca": "bg-hub-surface-2 text-hub-ink",
  "r-held": "bg-hub-warning-tint text-hub-warning",
  "r-held-late": "bg-hub-danger-tint text-hub-danger",
  "h-ok": "bg-hub-success-tint text-hub-success",
  "h-warn": "bg-hub-warning-tint text-hub-warning",
  "h-critical": "bg-hub-danger-tint text-hub-danger",
  "h-none": "bg-hub-surface-2 text-hub-ink-muted",
  available: "bg-hub-success-tint text-hub-success",
  "coming-soon": "bg-hub-surface-2 text-hub-ink",
  "rating-up": "bg-hub-success-tint text-hub-success",
  "rating-down": "bg-hub-warning-tint text-hub-warning",
  "fs-pending": "bg-hub-warning-tint text-hub-warning",
  "fs-done": "bg-hub-success-tint text-hub-success",
  "fs-dismissed": "bg-hub-surface-2 text-hub-ink-muted",
  // P14 (14-30)
  "dom-none": "bg-hub-surface-2 text-hub-ink-muted",
  "dom-checking": "bg-hub-surface-2 text-hub-ink",
  "dom-cds": "bg-hub-surface-2 text-hub-ink",
  "dom-waiting": "bg-hub-surface-2 text-hub-ink",
  "dom-ready": "bg-hub-success-tint text-hub-success",
  "dom-broken": "bg-hub-danger-tint text-hub-danger",
  "rec-cds": "bg-hub-surface-2 text-hub-ink",
  "rec-email": "bg-hub-surface-2 text-hub-ink",
  "rec-yours": "border border-hub-border-strong bg-hub-surface text-hub-ink",
  "rec-copied": "bg-hub-success-tint text-hub-success",
  "rec-checking": "bg-hub-surface-2 text-hub-ink-muted",
  "rec-added": "bg-hub-surface-2 text-hub-ink",
  "rec-pending": "bg-hub-warning-tint text-hub-warning",
  "g-match": "bg-hub-success-tint text-hub-success",
  "g-ttl": "bg-hub-success-tint text-hub-success",
  "g-mismatch": "bg-hub-danger-tint text-hub-danger",
  "g-missing": "bg-hub-danger-tint text-hub-danger",
  "g-added": "bg-hub-surface-2 text-hub-ink",
  "g-ack": "bg-hub-surface-2 text-hub-ink",
  "g-override": "bg-hub-warning-tint text-hub-warning",
  "m-waiting": "bg-hub-surface-2 text-hub-ink-muted",
  "m-running": "bg-hub-surface-2 text-hub-ink",
  "m-done": "bg-hub-success-tint text-hub-success",
  "m-owner": "bg-hub-warning-tint text-hub-warning",
  "m-prepared": "bg-hub-success-tint text-hub-success",
  "m-failed": "bg-hub-danger-tint text-hub-danger",
  "m-skipped": "bg-hub-surface-2 text-hub-ink-muted",
  "m-cancelled": "bg-hub-surface-2 text-hub-ink-muted",
  "s-leaving": "bg-hub-warning-tint text-hub-warning",
};

// P13 staff tone icons (13-UI-SPEC lines 190-221), all 14px and aria-hidden.
const STAFF_ICONS: Partial<Record<BadgeTone, typeof TriangleAlert>> = {
  "sla-risk": ClockAlert,
  "sla-missed": TriangleAlert,
  "p-urgent": TriangleAlert,
  internal: EyeOff,
  "s-notice": CirclePause,
  "s-suspended": Ban,
  "r-held-late": Hourglass,
  "h-critical": TriangleAlert,
  "rating-up": ThumbsUp,
  "rating-down": ThumbsDown,
  // P14 (14-30 choice 1), 14px, aria-hidden.
  "dom-waiting": Clock,
  "dom-broken": TriangleAlert,
  "rec-cds": Lock,
  "rec-email": Mail,
  "rec-copied": CircleCheck,
  "g-mismatch": TriangleAlert,
  "g-missing": TriangleAlert,
  "m-failed": TriangleAlert,
  "s-leaving": DoorOpen,
};

export interface BadgeProps {
  tone: BadgeTone;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone, children, className }: BadgeProps) {
  const StaffIcon = STAFF_ICONS[tone];
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded px-2 py-1 font-hub text-sm leading-none " +
        `font-semibold whitespace-nowrap ${TONES[tone]}${className ? ` ${className}` : ""}`
      }
    >
      {tone === "hidden" ? (
        <EyeOff aria-hidden size={16} strokeWidth={2} />
      ) : tone === "bouncing" ? (
        <TriangleAlert aria-hidden size={16} strokeWidth={2} />
      ) : tone === "paused" ? (
        <PauseCircle aria-hidden size={14} strokeWidth={2} />
      ) : tone === "unpaid" ||
        tone === "stripe-attention" ||
        tone === "speed-poor" ? (
        <TriangleAlert aria-hidden size={14} strokeWidth={2} />
      ) : tone === "update-waiting" ? (
        <TriangleAlert aria-hidden size={14} strokeWidth={2} />
      ) : tone === "password" ? (
        <Lock aria-hidden size={16} strokeWidth={2} />
      ) : tone === "checking" ? (
        <Clock aria-hidden size={14} strokeWidth={2} />
      ) : tone === "m-running" ? (
        <LoaderCircle
          aria-hidden
          size={14}
          strokeWidth={2}
          className="motion-safe:animate-spin"
        />
      ) : StaffIcon ? (
        <StaffIcon aria-hidden size={14} strokeWidth={2} />
      ) : null}
      {children}
    </span>
  );
}
